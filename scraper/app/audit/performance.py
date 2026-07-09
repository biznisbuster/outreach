"""Performance audit — page load, page weight, render-blocking, resource hints.

Inputs:
    raw_pages: list[dict] with at least ``url``, ``headers``, ``html``, ``fetch_ms``,
               ``page_weight_bytes`` (HTML byte size), and ``resource_timings``
               (list of {name, type, duration_ms, transfer_size, start_time_ms,
               initiatorType} — optional, populated by the runner when Playwright
               captures Navigation + Resource Timing API entries).

Outputs:
    PerfResult with raw metrics, score 0-100, and issues list.

The score weights emphasise **what the user feels**: TTFB and page weight carry
the most points. Render-blocking scripts and missing compression are common,
easy-to-spot problems and worth catching.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import statistics


@dataclass
class PerfResult:
    raw: dict
    score: int
    issues: list[str]


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def audit_performance(raw_pages: list[dict]) -> PerfResult:
    if not raw_pages:
        return PerfResult(raw={"empty": True}, score=0, issues=["No pages fetched."])

    # Medians across all pages — robust against outliers (one slow admin page)
    ttfbs = [p.get("fetch_ms", 0) for p in raw_pages]
    weights = [p.get("page_weight_bytes", 0) for p in raw_pages]
    med_ttfb = _median(ttfbs)
    med_weight_kb = _median(weights) / 1024

    # Counts per page → medians
    rb_counts = [_count_render_blocking(p.get("html", "")) for p in raw_pages]
    med_rb = _median(rb_counts)

    # Site-wide aggregation
    compression_pct = _compression_coverage(raw_pages)
    hint_pages = sum(1 for p in raw_pages if _has_resource_hints(p.get("html", "")))
    hint_pct = round(hint_pages / len(raw_pages) * 100)

    # HTTP/2 (one detection from any page is enough — header is per-connection)
    http2 = any(_http2_detected(p.get("headers") or {}) for p in raw_pages)

    # Optional Playwright timings (Navigation Timing API)
    fcp_ms = _percentile_from_pages(raw_pages, "first_contentful_paint_ms", 75)
    lcp_ms = _percentile_from_pages(raw_pages, "largest_contentful_paint_ms", 75)
    load_ms = _percentile_from_pages(raw_pages, "load_ms", 75)

    checks = {
        "ttfb_ok": med_ttfb <= 600,
        "ttfb_good": med_ttfb <= 300,
        "weight_ok": med_weight_kb <= 1500,
        "weight_good": med_weight_kb <= 800,
        "render_blocking_low": med_rb <= 4,
        "render_blocking_good": med_rb <= 1,
        "compression_ok": compression_pct >= 80,
        "http2": http2,
        "resource_hints_ok": hint_pct >= 50,
        "fcp_ok": fcp_ms is None or fcp_ms <= 2500,
        "lcp_ok": lcp_ms is None or lcp_ms <= 4000,
    }

    score = _score_checks(checks)
    raw = {
        "ttfb_ms_median": round(med_ttfb),
        "ttfb_ms_min": round(min(ttfbs)),
        "ttfb_ms_max": round(max(ttfbs)),
        "page_weight_kb_median": round(med_weight_kb, 1),
        "page_weight_kb_max": round(max(w / 1024 for w in weights), 1),
        "render_blocking_count_median": round(med_rb, 1),
        "compression_pct": compression_pct,
        "http2_detected": http2,
        "resource_hints_pages_pct": hint_pct,
        "fcp_ms_p75": fcp_ms,
        "lcp_ms_p75": lcp_ms,
        "load_ms_p75": load_ms,
    }
    issues = _issues_for(checks, raw)
    return PerfResult(raw=raw, score=score, issues=issues)


# ---------------------------------------------------------------------------
# Per-page measurements (computed from raw HTML)
# ---------------------------------------------------------------------------

# A <script src=...> in <head> without async/defer/type=module counts as render-blocking.
_HEAD_RE = re.compile(r"<head[^>]*>(.*?)</head>", re.DOTALL | re.IGNORECASE)
_SCRIPT_RE = re.compile(r"<script\b([^>]*)>", re.IGNORECASE)
_STYLE_RE = re.compile(r"<style\b([^>]*)>(.*?)</style>", re.DOTALL | re.IGNORECASE)
_LINK_STYLE_RE = re.compile(r"<link\b[^>]*rel=[\"']?stylesheet[\"']?[^>]*>", re.IGNORECASE)


def _count_render_blocking(html: str) -> int:
    """Count synchronous scripts + stylesheets in <head>."""
    if not html:
        return 0
    head_match = _HEAD_RE.search(html)
    head = head_match.group(1) if head_match else html
    count = 0

    # Inline <style> blocks anywhere in head block render
    count += len(_STYLE_RE.findall(head))

    # Render-blocking stylesheets
    for m in _LINK_STYLE_RE.finditer(head):
        tag = m.group(0).lower()
        # Anything with media="print" or onload="this.media='all'" deferred is non-blocking
        if "media=\"print\"" in tag or "media='print'" in tag:
            continue
        # onload trick to swap media
        if "onload" in tag and "media" in tag:
            continue
        count += 1

    # Scripts without async/defer/module count as render-blocking
    for m in _SCRIPT_RE.finditer(head):
        attrs = m.group(1).lower()
        if "async" in attrs or "defer" in attrs or "type=\"module\"" in attrs or "type='module'" in attrs:
            continue
        # Inline scripts (no src) still block parsing
        count += 1

    return count


def _has_resource_hints(html: str) -> bool:
    """Detect <link rel=preload|prefetch|preconnect|dns-prefetch>."""
    if not html:
        return False
    low = html.lower()
    return any(f'rel="{r}"' in low or f"rel='{r}'" in low for r in
               ("preload", "prefetch", "preconnect", "dns-prefetch"))


def _compression_coverage(raw_pages: list[dict]) -> int:
    """% of pages whose body was sent with gzip/br."""
    if not raw_pages:
        return 0
    n_ok = 0
    for p in raw_pages:
        ce = (p.get("headers") or {}).get("content-encoding", "").lower()
        if "gzip" in ce or "br" in ce or "zstd" in ce:
            n_ok += 1
    return round(n_ok / len(raw_pages) * 100)


def _http2_detected(headers: dict) -> bool:
    """Header-only heuristic: Alt-Svc or explicit HTTP/2 server hint.

    We can't observe the wire protocol from httpx directly, but most CDNs leak
    Alt-Svc. Modern servers also expose ``http2`` in ``Via`` or similar.
    """
    if not headers:
        return False
    alt = headers.get("alt-svc", "").lower()
    if "h2" in alt or "h2c" in alt:
        return True
    via = headers.get("via", "").lower()
    return "http/2" in via or " 2.0" in via


# ---------------------------------------------------------------------------
# Aggregates
# ---------------------------------------------------------------------------

def _median(xs: list[float]) -> float:
    return statistics.median(xs) if xs else 0.0


def _percentile_from_pages(raw_pages: list[dict], key: str, p: int):
    vals = [r[key] for r in raw_pages if r.get(key) is not None]
    if not vals:
        return None
    return _percentile(vals, p)


def _percentile(xs: list[float], p: int) -> float:
    if not xs:
        return 0.0
    s = sorted(xs)
    k = (len(s) - 1) * (p / 100)
    f = int(k)
    c = min(f + 1, len(s) - 1)
    return s[f] + (s[c] - s[f]) * (k - f)


# ---------------------------------------------------------------------------
# Scoring
# ---------------------------------------------------------------------------

def _score_checks(checks: dict) -> int:
    score = 0
    # TTFB (up to 25)
    if checks["ttfb_good"]:
        score += 25
    elif checks["ttfb_ok"]:
        score += 15
    # Weight (up to 25)
    if checks["weight_good"]:
        score += 25
    elif checks["weight_ok"]:
        score += 14
    # Render-blocking (up to 15)
    if checks["render_blocking_good"]:
        score += 15
    elif checks["render_blocking_low"]:
        score += 8
    # Compression (10)
    if checks["compression_ok"]:
        score += 10
    # HTTP/2 (10)
    if checks["http2"]:
        score += 10
    # Resource hints (5)
    if checks["resource_hints_ok"]:
        score += 5
    # FCP (5)
    if checks["fcp_ok"]:
        score += 5
    # LCP (5) — considered only if FCP passed too (dependency)
    if checks["lcp_ok"] and checks["fcp_ok"]:
        score += 5
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out: list[str] = []
    if not checks["ttfb_ok"]:
        ms = raw["ttfb_ms_median"]
        target = "600 ms"
        out.append(f"Median TTFB {ms} ms — over target {target}. Usually server / database / DNS.")
    elif not checks["ttfb_good"]:
        out.append(f"Median TTFB {raw['ttfb_ms_median']} ms — workable but not snappy.")
    if not checks["weight_ok"]:
        out.append(f"Median page weight {raw['page_weight_kb_median']} kB — over 1.5 MB target. Heavy images / unminified CSS.")
    elif not checks["weight_good"]:
        out.append(f"Median page weight {raw['page_weight_kb_median']} kB — could be much lighter.")
    if not checks["render_blocking_low"]:
        out.append(f"A median {raw['render_blocking_count_median']} render-blocking scripts/styles in <head>. Add defer/async.")
    elif not checks["render_blocking_good"]:
        out.append(f"A median {raw['render_blocking_count_median']} render-blocking resource — at least try to defer everything.")
    if not checks["compression_ok"]:
        out.append(f"Only {raw['compression_pct']}% of responses are gzip/brotli-compressed. Server config.")
    if not checks["http2"]:
        out.append("HTTP/2 not detected. Modern multiplexing & header compression missing.")
    if not checks["resource_hints_ok"]:
        out.append(f"Only {raw['resource_hints_pages_pct']}% of pages use resource hints (preload / preconnect / dns-prefetch).")
    if raw.get("fcp_ms_p75") and not checks["fcp_ok"]:
        out.append(f"First Contentful Paint p75 = {raw['fcp_ms_p75']} ms — over 2.5 s target.")
    if raw.get("lcp_ms_p75") and not checks["lcp_ok"] and checks["fcp_ok"]:
        out.append(f"Largest Contentful Paint p75 = {raw['lcp_ms_p75']} ms — over 4 s target.")
    return out
