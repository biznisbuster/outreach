"""aggregate.py — re-fetch + run all sub-audits + combine into site_signals.

Used by runner.py. Also exposed as a low-level API so it can be tested without
the FastAPI layer.
"""
from __future__ import annotations

import json
import re
import time
from typing import Iterable
from urllib.parse import urlparse

import httpx
import trafilatura

from . import security, performance, content, accessibility, mobile, structured, onpage, tech_stack, ui_design
from .site_rank import authority_score


USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like KHTML, like Gecko) Chrome/120.0 Safari/537.36"
FALLBACK_UA = "Mozilla/5.0"
_BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,sr;q=0.8",
}


# ---------------------------------------------------------------------------
# Re-fetcher — pulls raw HTML + headers for each URL the existing scrape knows about
# ---------------------------------------------------------------------------

def fetch_raw_pages(urls: list[str], delay_sec: float = 0.4, timeout: float = 15.0) -> list[dict]:
    """Fetch each URL once. Returns a list of per-page raw dicts.

    Schema:
        {
          "url": str,
          "status_code": int,
          "headers": {str: str},
          "html": str,
          "page_weight_bytes": int,
          "fetch_ms": int,
        }
    Skips URLs that fail non-recoverably.
    """
    out: list[dict] = []
    for url in urls:
        item = _fetch_one(url, timeout)
        if item:
            out.append(item)
        time.sleep(delay_sec)
    return out


def _fetch_one(url: str, timeout: float) -> dict | None:
    for headers in (_BROWSER_HEADERS, {**_BROWSER_HEADERS, "User-Agent": FALLBACK_UA}):
        t0 = time.time()
        try:
            with httpx.Client(headers=headers, follow_redirects=True, timeout=timeout) as c:
                r = c.get(url)
        except Exception:
            continue
        if r.status_code == 403:
            continue
        if r.status_code >= 400:
            # Still record the failure so the report shows it
            return {
                "url": url,
                "status_code": r.status_code,
                "headers": {k: v for k, v in r.headers.items()},
                "html": "",
                "page_weight_bytes": 0,
                "fetch_ms": int((time.time() - t0) * 1000),
            }
        body = r.content
        return {
            "url": url,
            "status_code": r.status_code,
            "headers": {k: v for k, v in r.headers.items()},
            "html": r.text,
            "page_weight_bytes": len(body),
            "fetch_ms": int((time.time() - t0) * 1000),
        }
    return None


# ---------------------------------------------------------------------------
# Per-page parsing (for the audits that need structured text + accessibility counters)
# ---------------------------------------------------------------------------

_INPUT_RE = re.compile(r"<input\b([^>]*)>", re.IGNORECASE | re.DOTALL)
_LABEL_ATTR_RE = re.compile(r'\bid=["\']([^"\']+)["\']', re.IGNORECASE)
_IMG_RE = re.compile(r"<img\b([^>]*)>", re.IGNORECASE | re.DOTALL)
_IMG_RESPONSIVE_RE = re.compile(r'<img\b[^>]*\bsrcset=["\'][^"\']+["\']', re.IGNORECASE)
_LINK_RE = re.compile(r"<a\b([^>]*)>(.*?)</a>", re.IGNORECASE | re.DOTALL)
_BUTTON_RE = re.compile(r"<button\b([^>]*)>(.*?)</button>", re.IGNORECASE | re.DOTALL)
_HEADING_RE = re.compile(r"<(h[1-6])\b[^>]*>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
_LANG_RE = re.compile(r'<html\b[^>]*\blang=["\']([^"\']+)["\']', re.IGNORECASE)
_HTML_TAG_RE = re.compile(r"<html\b([^>]*)>", re.IGNORECASE)


def enrich_pages_with_extra(raw_pages: list[dict]) -> list[dict]:
    """Add per-page parsed fields needed by the audits:
        - body_text (trafilatura)
        - headings [{level, text}]
        - html_lang
        - input_count, input_with_label_count
        - image_total, image_responsive_count, image_with_alt_count, alt_ratio
        - link_count, link_with_text_count
        - button_count, button_with_text_count
        - aria_count
        - canonical, robots_meta strings (for structured coverage)
    """
    out = []
    for p in raw_pages:
        html = p.get("html") or ""
        body_text = ""
        try:
            body_text = trafilatura.extract(html, include_comments=False, include_tables=False) or ""
        except Exception:
            pass

        word_count = len(body_text.split())

        headings = []
        for m in _HEADING_RE.finditer(html):
            level = int(m.group(1)[1])
            text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(2))).strip()
            headings.append({"level": level, "text": text})

        # Images
        imgs = _IMG_RE.findall(html)
        image_total = len(imgs)
        image_with_alt_count = 0
        for attrs in imgs:
            m = re.search(r'\salt=["\']([^"\']*)["\']', attrs, re.IGNORECASE)
            if m and m.group(1).strip():
                image_with_alt_count += 1
        image_responsive_count = len(_IMG_RESPONSIVE_RE.findall(html))
        alt_ratio = (image_with_alt_count / image_total) if image_total > 0 else 1.0

        # Forms
        inputs = _INPUT_RE.findall(html)
        input_count = len(inputs)
        input_with_label_count = 0
        # Extract all <label for=...> ids
        label_ids = set(re.findall(r'<label\b[^>]*\bfor=["\']([^"\']+)["\']', html, re.IGNORECASE))
        # Also accept <input id="x"> covered by <label> wrapper — best-effort: count labels with embedded input
        embedded = len(re.findall(r'<label\b[^>]*>\s*<input\b', html, re.IGNORECASE))
        for attrs in inputs:
            id_match = _LABEL_ATTR_RE.search(attrs)
            if id_match and id_match.group(1) in label_ids:
                input_with_label_count += 1
        input_with_label_count += embedded
        label_ratio = (input_with_label_count / input_count) if input_count > 0 else 1.0

        # Links & buttons
        link_count, link_with_text_count = _count_accessible(_LINK_RE, html, "a")
        button_count, button_with_text_count = _count_accessible(_BUTTON_RE, html, "button")

        # aria-*
        aria_count = len(re.findall(r'\baria-[a-z]+=', html, re.IGNORECASE))

        # html lang
        html_match = _HTML_TAG_RE.search(html)
        html_lang = ""
        if html_match:
            lang_match = _LANG_RE.search(html_match.group(0))
            if lang_match:
                html_lang = lang_match.group(1)

        # inline styles (font-size etc.) — concatenated
        inline_style = " ".join(re.findall(r'<style\b[^>]*>(.*?)</style>', html, re.IGNORECASE | re.DOTALL))

        out.append({
            **p,
            "body_text": body_text,
            "word_count": word_count,
            "headings": headings,
            "html_lang": html_lang,
            "image_total": image_total,
            "image_responsive_count": image_responsive_count,
            "image_with_alt_count": image_with_alt_count,
            "alt_ratio": alt_ratio,
            "input_count": input_count,
            "input_with_label_count": input_with_label_count,
            "label_ratio": label_ratio,
            "link_count": link_count,
            "link_with_text_count": link_with_text_count,
            "button_count": button_count,
            "button_with_text_count": button_with_text_count,
            "aria_count": aria_count,
            "inline_style": inline_style,
        })
    return out


def _count_accessible(re_pattern, html: str, kind: str) -> tuple[int, int]:
    """Count total links/buttons and those with non-empty accessible text.

    A link/button is considered to have accessible text if it has:
    - non-empty inner text (stripped of tags), OR
    - aria-label="..." attribute, OR
    - title="..." attribute
    """
    total = 0
    with_text = 0
    for m in re_pattern.finditer(html):
        total += 1
        attrs = m.group(1) or ""
        body = m.group(2) or ""
        text = re.sub(r"<[^>]+>", "", body).strip()
        if text:
            with_text += 1
            continue
        if re.search(r'\baria-label=["\']([^"\']+?)["\']', attrs, re.IGNORECASE):
            with_text += 1
            continue
        if re.search(r'\btitle=["\']([^"\']+?)["\']', attrs, re.IGNORECASE):
            with_text += 1
            continue
    return total, with_text


# ---------------------------------------------------------------------------
# Top-level aggregate — pulls all metrics together
# ---------------------------------------------------------------------------

def aggregate(
    enriched_pages: list[dict],
    base_url: str,
    traffic_signals: dict,
    screenshot_path: str | None = None,
    progress_callback=None,
) -> dict:
    """Run every audit module. Return a flat ``signals`` dict with:
        - per-category sub-score and raw values
        - per-page metrics for the report
        - tech-stack detection
        - traffic signals
        - UI/Design score via MiniMax M3 vision (uses screenshot_path if set)

    ``progress_callback`` (opciono) dobija ``{"phase_index": int, "phase": str,
    "message": str}`` pre svakog većeg sub-audita (Security, Performance, Content,
    Mobile+A11y, UI/Design). Ovo omogućava GUI da pokaže REAL phase iz backenda
    umesto da ciklično rotira paušalne stringove.
    """
    def emit(idx: int, msg: str = "") -> None:
        if progress_callback is None:
            return
        from ..audit_jobs import PHASES
        progress_callback({
            "phase": PHASES[idx],
            "phase_index": idx,
            "total_phases": len(PHASES),
            "message": msg,
        })

    # Compute order je prilagođen korisničkim fazama (progress emit). Sub-auditi
    # su uglavnom nezavisni, samo dva zavisna: tech_score (koristi perf.raw za
    # http2_detected) i authority_score (koristi onp.raw + traffic_signals).

    # Phase 1: SEO + Security + Tech (headers-driven, brzi)
    emit(1, "Analyzing SEO, security headers, tech stack…")
    sec = security.audit_security(enriched_pages, base_url)
    struct = structured.audit_structured(enriched_pages)
    onp = onpage.audit_onpage(enriched_pages)

    # Phase 2: Performance + Content (teži analizatori — page weight, Flesch…)
    emit(2, "Analyzing performance, content depth, readability…")
    perf = performance.audit_performance(enriched_pages)
    cont = content.audit_content(enriched_pages)

    # Tech stack detection + authority (zavisi od perf i onp iz prethodnih faza)
    homepage = _pick_homepage(enriched_pages, base_url)
    detected = tech_stack.detect_tech_stack(
        enriched_pages, homepage_headers=homepage.get("headers") if homepage else None
    )
    tech_score = tech_stack.tech_modernness_score(detected, http2=perf.raw.get("http2_detected", False))
    auth_score, auth_issues = authority_score(traffic_signals, onp.raw)

    # Phase 3: Mobile + Accessibility (viewport meta, alt text, ARIA, skip nav…)
    emit(3, "Checking mobile + accessibility (viewport, alt text, ARIA landmarks, skip nav)…")
    a11y = accessibility.audit_accessibility(enriched_pages)
    mob = mobile.audit_mobile(enriched_pages)

    # Phase 4: UI/Design (MiniMax M3 vision)
    emit(4, "Sending homepage screenshot to MiniMax M3 for UI/Design rating…")
    ui = ui_design.audit_ui_design(screenshot_path, base_url=base_url)

    # Per-page SEO score — mirror the old per-page logic so the report can show
    # a per-page number; we re-derive it cheaply here.
    for p in enriched_pages:
        p["per_page_score"] = _quick_seo_score(p)
        p["issues"] = _quick_seo_issues(p)

    category_scores = {
        "seo":         _seo_category_score(enriched_pages, struct),
        "performance": perf.score,
        "content":     cont.score,
        "security":    sec.score,
        "mobile_a11y": round((mob.score + a11y.score) / 2),
        "tech_modern": tech_score,
        "authority":   auth_score,
        # Ako UI design skipped (nema API key / slika / score), koristi
        # neutralnu vrednost (50) da ne povuče overall_rank nadole.
        "ui_design":   ui.get("score") if ui.get("score") is not None else 50,
    }
    # Attach per-category issues — list[dict {name, issues: [str]}]
    ui_issues = list(ui.get("issues", []))
    if ui.get("skipped"):
        # Pokaži korisniku ZAŠTO je preskočeno — ne skrivaj config problem.
        ui_issues = ui_issues + ([ui.get("skip_reason", "")] if ui.get("skip_reason") else [])
    category_issue_lists = {
        "seo":         _seo_category_issues(enriched_pages, struct),
        "performance": perf.issues,
        "content":     cont.issues,
        "security":    sec.issues,
        "mobile_a11y": list(mob.issues) + list(a11y.issues),
        "tech_modern": [],
        "authority":   auth_issues,
        "ui_design":   ui_issues,
    }

    # Per-page mini summary
    pages_summary = [
        {
            "url": p.get("url"),
            "status_code": p.get("status_code"),
            "fetch_ms": p.get("fetch_ms"),
            "page_weight_kb": round((p.get("page_weight_bytes") or 0) / 1024, 1),
            "score": p.get("per_page_score"),
            "issues": p.get("issues", []),
        }
        for p in enriched_pages
    ]

    return {
        "category_scores": category_scores,
        "category_issues": category_issue_lists,
        "category_metrics": {
            "seo":         {"meta": _seo_category_metrics(enriched_pages, struct)},
            "performance": perf.raw,
            "content":     cont.raw,
            "security":    sec.raw,
            "mobile_a11y": {"mobile": mob.raw, "accessibility": a11y.raw},
            "tech_modern": detected,
            "authority":   {"traffic": traffic_signals, "onpage": onp.raw},
            "ui_design":   ui,  # čitav modul output (score, issues, summary, skipped, raw)
        },
        "pages": pages_summary,
    }


def _pick_homepage(pages: list[dict], base_url: str) -> dict:
    target = base_url.rstrip("/")
    for p in pages:
        if (p.get("url") or "").rstrip("/") == target:
            return p
    return pages[0] if pages else {}


# ---------------------------------------------------------------------------
# Per-page lightweight SEO scoring used to populate the per-page column
# ---------------------------------------------------------------------------

def _quick_seo_score(p: dict) -> int:
    score = 0
    if p.get("title"):
        score += 15
        if 30 <= len(p["title"]) <= 60:
            score += 10
    if p.get("meta_description"):
        score += 10
        if 70 <= len(p["meta_description"]) <= 160:
            score += 10
    if p.get("h1"):
        score += 10
    if (p.get("word_count") or 0) >= 300:
        score += 15
    if (p.get("alt_ratio") or 1.0) >= 0.8:
        score += 10
    elif (p.get("alt_ratio") or 0) >= 0.5:
        score += 5
    if p.get("has_structured_data"):
        score += 10
    if (p.get("internal_links") or 0) >= 2:
        score += 10
    return min(100, score)


def _quick_seo_issues(p: dict) -> list[str]:
    issues = []
    if not p.get("title"):
        issues.append("Missing <title>")
    elif not (30 <= len(p.get("title") or "") <= 60):
        issues.append(f"<title> length {len(p.get('title',''))} (target 30–60)")
    if not p.get("meta_description"):
        issues.append("Missing meta description")
    elif not (70 <= len(p.get("meta_description") or "") <= 160):
        issues.append(f"Meta description {len(p.get('meta_description',''))} chars (target 70–160)")
    if not p.get("h1"):
        issues.append("Missing H1")
    if (p.get("word_count") or 0) < 300:
        issues.append(f"Thin content: {p.get('word_count', 0)} words")
    if (p.get("alt_ratio") or 1.0) < 0.8:
        issues.append(f"alt-text coverage {(p.get('alt_ratio') or 0) * 100:.0f}%")
    return issues


# ---------------------------------------------------------------------------
# SEO category — aggregates per-page metrics into a single score
# ---------------------------------------------------------------------------

def _seo_category_score(enriched_pages: list[dict], struct_result) -> int:
    n = len(enriched_pages) or 1
    scores = [_quick_seo_score(p) for p in enriched_pages]
    avg = sum(scores) / n if scores else 0

    title_pct = sum(1 for p in enriched_pages if p.get("title")) / n * 100
    desc_pct = sum(1 for p in enriched_pages if p.get("meta_description")) / n * 100
    h1_pct = sum(1 for p in enriched_pages if p.get("h1")) / n * 100

    # Blend with structured-data coverage
    sd_pct = struct_result.raw.get("jsonld_pages_pct", 0)
    canonical_pct = struct_result.raw.get("canonical_pct", 0)

    blended = (avg * 0.5 +
               title_pct * 0.15 +
               desc_pct * 0.10 +
               h1_pct * 0.10 +
               sd_pct * 0.10 +
               canonical_pct * 0.05)
    return min(100, round(blended))


def _seo_category_issues(enriched_pages: list[dict], struct_result) -> list[str]:
    n = len(enriched_pages) or 1
    issues = []

    title_missing = n - sum(1 for p in enriched_pages if p.get("title"))
    if title_missing:
        issues.append(f"<title> missing on {title_missing} of {n} pages.")
    desc_missing = n - sum(1 for p in enriched_pages if p.get("meta_description"))
    if desc_missing:
        issues.append(f"meta description missing on {desc_missing} of {n} pages.")
    h1_missing = n - sum(1 for p in enriched_pages if p.get("h1"))
    if h1_missing:
        issues.append(f"H1 missing on {h1_missing} of {n} pages.")

    sd_pct = struct_result.raw.get("jsonld_pages_pct", 0)
    if sd_pct < 50:
        issues.append(f"Structured data present on only {sd_pct}% of pages.")
    canonical_pct = struct_result.raw.get("canonical_pct", 0)
    if canonical_pct < 70:
        issues.append(f"Canonical URL on only {canonical_pct}% of pages — duplicate-content risk.")
    return issues


def _seo_category_metrics(enriched_pages, struct_result) -> dict:
    n = len(enriched_pages) or 1
    return {
        "pages_analyzed": n,
        "title_present_pct": round(sum(1 for p in enriched_pages if p.get("title")) / n * 100),
        "meta_description_present_pct": round(sum(1 for p in enriched_pages if p.get("meta_description")) / n * 100),
        "h1_present_pct": round(sum(1 for p in enriched_pages if p.get("h1")) / n * 100),
        "avg_word_count": round(sum(p.get("word_count") or 0 for p in enriched_pages) / n),
        "canonical_pct": struct_result.raw.get("canonical_pct", 0),
        "jsonld_pct": struct_result.raw.get("jsonld_pages_pct", 0),
        "structured_pct": struct_result.raw.get("canonical_pct", 0),
    }
