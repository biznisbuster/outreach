"""Structured-data & metadata audit: canonical, OpenGraph, Twitter, hreflang,
robots meta, favicon.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
from urllib.parse import urlparse


@dataclass
class StructuredResult:
    raw: dict
    score: int
    issues: list[str]


# Patterns — compiled once
_OG_RE_TEMPLATE = r'<meta\b[^>]*property=["\']og:{name}["\'][^>]*>'
_TW_RE_TEMPLATE = r'<meta\b[^>]*name=["\']twitter:{name}["\'][^>]*>'


def audit_structured(pages: list[dict]) -> StructuredResult:
    if not pages:
        return StructuredResult(raw={"empty": True}, score=0, issues=["No pages."])

    n = len(pages)

    # Canonical, robots meta — coverage across pages
    canonical_pct = _coverage(pages, "canonical")
    robots_pct = _coverage(pages, "robots_meta")

    # Favicon — only the homepage matters
    homepage = _pick_homepage(pages)
    has_favicon = bool((homepage.get("html") or "") and re.search(
        r'<link\b[^>]*rel=["\']?(?:shortcut\s+)?icon["\']?[^>]*>', homepage["html"], re.IGNORECASE))

    # OpenGraph coverage on homepage
    og = _count_og(homepage.get("html", ""))
    tw = _count_twitter(homepage.get("html", ""))

    # hreflang — appears across pages
    hreflang_pct = _hreflang_coverage(pages)

    # JSON-LD presence (already in seo_metrics_json) — site-wide %
    jsonld_pct = round(sum(1 for p in pages if p.get("has_structured_data")) / n * 100)

    checks = {
        "canonical_perfect": canonical_pct >= 95,
        "canonical_good": canonical_pct >= 70,
        "og_perfect": og >= 5,
        "og_good": og >= 3,
        "twitter_perfect": tw >= 4,
        "twitter_good": tw >= 2,
        "hreflang_na_or_good": hreflang_pct == 0 or hreflang_pct >= 80,
        "favicon": has_favicon,
        "jsonld_perfect": jsonld_pct >= 50,
        "jsonld_good": jsonld_pct >= 20,
        "robots_meta_ok": robots_pct >= 50 or robots_pct == 0,  # 0 is fine (no robots meta = index,follow)
    }

    score = _score_checks(checks)
    raw = {
        "pages_analyzed": n,
        "canonical_pct": canonical_pct,
        "robots_meta_pct": robots_pct,
        "favicon_present": has_favicon,
        "opengraph_count_homepage": og,
        "twitter_count_homepage": tw,
        "hreflang_coverage_pct": hreflang_pct,
        "jsonld_pages_pct": jsonld_pct,
    }
    issues = _issues_for(checks, raw)
    return StructuredResult(raw=raw, score=score, issues=issues)


def _pick_homepage(pages: list[dict]) -> dict:
    for p in pages:
        path = urlparse(p.get("url", "")).path.rstrip("/")
        if path in ("", "/"):
            return p
    return pages[0]


def _coverage(pages: list[dict], what: str) -> int:
    """% of pages that contain a canonical link or robots meta tag with non-empty content."""
    n = len(pages) or 1
    ok = 0
    for p in pages:
        if what == "canonical":
            if re.search(r'<link\b[^>]*rel=["\']canonical["\'][^>]*href=["\']([^"\']+)["\']',
                         p.get("html", ""), re.IGNORECASE):
                ok += 1
        elif what == "robots_meta":
            m = re.search(r'<meta\b[^>]*name=["\']robots["\'][^>]*content=["\']([^"\']+)["\']',
                          p.get("html", ""), re.IGNORECASE)
            if m and m.group(1).strip():
                ok += 1
    return round(ok / n * 100)


def _count_og(html: str) -> int:
    if not html:
        return 0
    keys = ("title", "description", "image", "type", "url", "site_name", "locale")
    return sum(1 for k in keys if re.search(_OG_RE_TEMPLATE.format(name=k), html, re.IGNORECASE))


def _count_twitter(html: str) -> int:
    if not html:
        return 0
    keys = ("card", "title", "description", "image")
    return sum(1 for k in keys if re.search(_TW_RE_TEMPLATE.format(name=k), html, re.IGNORECASE))


def _hreflang_coverage(pages: list[dict]) -> int:
    hreflang_re = re.compile(r'<link\b[^>]*rel=["\']alternate["\'][^>]*hreflang=["\']', re.IGNORECASE)
    n = len(pages) or 1
    if any(hreflang_re.search(p.get("html", "")) for p in pages):
        # Site is multilingual: require hreflang on lang-relevant pages
        have = sum(1 for p in pages if hreflang_re.search(p.get("html", "")))
        return round(have / n * 100)
    return 0  # Single-language site — neutral


def _score_checks(checks: dict) -> int:
    score = 0
    # canonical (30)
    if checks["canonical_perfect"]:
        score += 30
    elif checks["canonical_good"]:
        score += 14
    # OG (25)
    if checks["og_perfect"]:
        score += 25
    elif checks["og_good"]:
        score += 12
    # Twitter (15)
    if checks["twitter_perfect"]:
        score += 15
    elif checks["twitter_good"]:
        score += 7
    # favicon (10)
    if checks["favicon"]:
        score += 10
    # hreflang (5 — small bonus)
    if checks["hreflang_na_or_good"]:
        score += 5
    # JSON-LD (15)
    if checks["jsonld_perfect"]:
        score += 15
    elif checks["jsonld_good"]:
        score += 7
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out = []
    if not checks["canonical_good"]:
        out.append(f"Canonical link present on only {raw['canonical_pct']}% of pages — duplicate-content risk.")
    elif not checks["canonical_perfect"]:
        out.append(f"Canonical coverage {raw['canonical_pct']}% — close, target >=95%.")
    if not checks["og_good"]:
        out.append(f"OpenGraph tags on homepage: {raw['opengraph_count_homepage']}/7 — link previews will look bad on social.")
    elif not checks["og_perfect"]:
        out.append(f"OpenGraph complete except for {7 - raw['opengraph_count_homepage']} missing tags.")
    if not checks["twitter_good"]:
        out.append(f"Twitter Card tags on homepage: {raw['twitter_count_homepage']}/4.")
    if not checks["favicon"]:
        out.append("No <link rel=\"icon\"> found on the homepage.")
    if not checks["hreflang_na_or_good"]:
        out.append(f"hreflang coverage {raw['hreflang_coverage_pct']}% — multilingual site needs hreflang on every page.")
    if not checks["jsonld_good"]:
        out.append(f"JSON-LD / structured data present on only {raw['jsonld_pages_pct']}% of pages — rich results unlikely.")
    elif not checks["jsonld_perfect"]:
        out.append(f"Structured data present on {raw['jsonld_pages_pct']}% of pages — room to expand.")
    return out
