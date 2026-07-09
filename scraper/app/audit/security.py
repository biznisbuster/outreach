"""Security headers + HTTPS enforcement audit.

Pure functions, no IO. Caller passes:

    raw_pages: list of {"url", "headers", "status_code", "fetch_ms", "page_weight_bytes"}
    base_url:  str — origin form, e.g. "https://example.com"

Returns a dict with individual checks + aggregated score + issues list.

The score is 0-100. Each check yields a fixed number of points; missing checks
show up as ``issues`` so the user can see exactly what to bring up with the
prospect.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import urlparse

# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

@dataclass
class SecurityResult:
    raw: dict
    score: int
    issues: list[str]


def audit_security(raw_pages: list[dict], base_url: str) -> SecurityResult:
    """Compute security-posture result.

    `raw_pages` shape: each item at minimum has ``url`` and ``headers``. We use
    headers from the **homepage** primarily — they are sufficient for most
    checks and reflect what the typical visitor gets.
    """
    homepage = _pick_homepage(raw_pages, base_url)
    headers = {k.lower(): v for k, v in (homepage.get("headers") or {}).items()}

    # 1) HTTPS enforcement: was the origin https and did we ever land on http?
    parsed = urlparse(base_url)
    https_origin = parsed.scheme == "https"

    # Mixed content: do any non-homepage pages respond over http?
    mixed = 0
    for p in raw_pages:
        if p.get("url", "").startswith("http://"):
            mixed += 1

    checks = {
        "https_origin": https_origin,
        "no_mixed_content": mixed == 0,
        "hsts": _has_hsts(headers),
        "csp": _has_csp(headers),
        "x_frame_options": _has_xfo(headers),
        "x_content_type_options": _has_xcto(headers),
        "referrer_policy": _has_referrer_policy(headers),
        "permissions_policy": _has_permissions_policy(headers),
    }

    score = _score_checks(checks)
    issues = _issues_for(checks, mixed=mixed)
    raw = {**checks, "mixed_content_pages": mixed}
    return SecurityResult(raw=raw, score=score, issues=issues)


# ---------------------------------------------------------------------------
# Individual header checks
# ---------------------------------------------------------------------------

def _has_hsts(headers: dict) -> bool:
    h = headers.get("strict-transport-security", "")
    return bool(h) and "max-age" in h.lower()


def _has_csp(headers: dict) -> bool:
    return bool(headers.get("content-security-policy", "").strip())


def _has_xfo(headers: dict) -> bool:
    # Either classic X-Frame-Options OR frame-ancestors in modern CSP.
    if headers.get("x-frame-options"):
        return True
    csp = headers.get("content-security-policy", "")
    return "frame-ancestors" in csp.lower()


def _has_xcto(headers: dict) -> bool:
    return headers.get("x-content-type-options", "").lower().strip() == "nosniff"


def _has_referrer_policy(headers: dict) -> bool:
    rp = headers.get("referrer-policy", "").lower()
    return bool(rp) and rp not in ("", "unsafe-url")


def _has_permissions_policy(headers: dict) -> bool:
    return bool(headers.get("permissions-policy", "").strip() or headers.get("feature-policy", "").strip())


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

# Each check yields points. Total must sum to 100.
_POINTS = {
    "https_origin": 25,
    "no_mixed_content": 10,
    "hsts": 15,
    "csp": 20,
    "x_frame_options": 10,
    "x_content_type_options": 5,
    "referrer_policy": 8,
    "permissions_policy": 7,
}


def _score_checks(checks: dict) -> int:
    score = 0
    for k, ok in checks.items():
        if ok:
            score += _POINTS[k]
    return min(100, score)


# ---------------------------------------------------------------------------
# Issues — actionable strings to surface in the report
# ---------------------------------------------------------------------------

_ISSUES = {
    "https_origin": "Site not served over HTTPS — modern browsers will warn visitors and Google penalizes ranking.",
    "no_mixed_content": "Some pages still load over plain HTTP — mixed content browsers will block.",
    "hsts": "Strict-Transport-Security header missing — clients can be downgraded to HTTP via SSL-stripping.",
    "csp": "Content-Security-Policy header missing — page is fully exposed to XSS and injection.",
    "x_frame_options": "Missing clickjacking protection (X-Frame-Options or frame-ancestors in CSP).",
    "x_content_type_options": "X-Content-Type-Options: nosniff missing — browsers may MIME-sniff responses.",
    "referrer_policy": "Referrer-Policy header missing or unsafe — full URLs leak to third parties.",
    "permissions_policy": "Permissions-Policy header missing — browser APIs left wide open by default.",
}


def _issues_for(checks: dict, mixed: int) -> list[str]:
    issues = []
    for k, ok in checks.items():
        if not ok:
            issues.append(_ISSUES[k])
    if mixed > 0:
        issues.insert(0, f"{mixed} page(s) still served over plain HTTP.")
    return issues


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _pick_homepage(raw_pages: list[dict], base_url: str) -> dict:
    """Pick the homepage entry by URL match. Falls back to first page."""
    target = base_url.rstrip("/")
    for p in raw_pages:
        if (p.get("url") or "").rstrip("/") == target:
            return p
    return raw_pages[0] if raw_pages else {"headers": {}}
