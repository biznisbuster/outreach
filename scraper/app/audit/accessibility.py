"""Accessibility audit — alt text, labels, language, ARIA, skip links.

Score 0-100 across the whole site (homepage + every scraped page).
"""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class A11yResult:
    raw: dict
    score: int
    issues: list[str]


def audit_accessibility(pages: list[dict]) -> A11yResult:
    if not pages:
        return A11yResult(raw={"empty": True}, score=0, issues=["No pages."])

    n = len(pages)

    # 1) alt-text coverage aggregated per page → avg ratio
    alt_ratios = [_safe_ratio(p) for p in pages]
    avg_alt = sum(alt_ratios) / n if n else 0

    # 2) html lang attribute — must be on <html>, present on all pages ideally
    langs_ok = sum(1 for p in pages if (p.get("html_lang") or "").strip())
    lang_pct = round(langs_ok / n * 100)

    # 3) form labels
    label_ratio = _form_label_ratio_avg(pages)

    # 4) link / button accessible text coverage
    acc_text_pct = _accessible_text_pct(pages)

    # 5) ARIA usage
    aria_avg = sum(p.get("aria_count", 0) for p in pages) / n

    # 6) skip-to-content link presence (homepage at minimum)
    homepage = pages[0]
    has_skip = _has_skip_link(homepage.get("html", ""))

    # 7) title presence
    titles_ok = sum(1 for p in pages if (p.get("title") or "").strip())
    title_pct = round(titles_ok / n * 100)

    checks = {
        "alt_good": avg_alt >= 0.95,
        "alt_ok": avg_alt >= 0.8,
        "lang_good": lang_pct >= 95,
        "lang_ok": lang_pct >= 70,
        "labels_good": label_ratio >= 0.9,
        "labels_ok": label_ratio >= 0.7,
        "acc_text_good": acc_text_pct >= 95,
        "acc_text_ok": acc_text_pct >= 80,
        "skip_link": has_skip,
        "title_present": title_pct >= 95,
        "aria_used": aria_avg >= 1,
    }

    score = _score_checks(checks)
    raw = {
        "pages_analyzed": n,
        "alt_text_coverage_avg": round(avg_alt, 2),
        "html_lang_pct": lang_pct,
        "form_label_ratio_avg": round(label_ratio, 2),
        "accessible_text_pct": acc_text_pct,
        "aria_count_avg": round(aria_avg, 1),
        "has_skip_link": has_skip,
        "title_present_pct": title_pct,
    }
    issues = _issues_for(checks, raw)
    return A11yResult(raw=raw, score=score, issues=issues)


def _safe_ratio(p: dict) -> float:
    r = p.get("alt_ratio")
    if r is None:
        return 1.0  # No images = trivially OK
    return float(r)


def _form_label_ratio_avg(pages: list[dict]) -> float:
    ratios = []
    for p in pages:
        inputs = p.get("input_count", 0)
        labels = p.get("input_with_label_count", 0)
        if inputs > 0:
            ratios.append(labels / inputs)
    if not ratios:
        return 1.0
    return sum(ratios) / len(ratios)


def _accessible_text_pct(pages: list[dict]) -> float:
    """Average % of (a + button) elements that have non-empty accessible text."""
    ratios = []
    for p in pages:
        total = p.get("link_count", 0) + p.get("button_count", 0)
        with_text = p.get("link_with_text_count", 0) + p.get("button_with_text_count", 0)
        if total > 0:
            ratios.append(with_text / total)
    if not ratios:
        return 1.0
    return round(sum(ratios) / len(ratios) * 100)


# Skip-to-content heuristic: an <a href="#..."> near the top of <body> with
# text matching "(skip to|skip-to)" or aria-label matching.
_SKIP_RE = re.compile(
    r'<a\b[^>]*href=["\']#[^"\']+["\'][^>]*>\s*(?:<!--.*?-->)?\s*(?:Skip to|Skok na|Preči na|Skoči na|Preskoči)',
    re.IGNORECASE,
)


def _has_skip_link(html: str) -> bool:
    if not html:
        return False
    # Try to find in the first 50 KB (skip links are always near the top)
    return bool(_SKIP_RE.search(html[:50000]))


def _score_checks(checks: dict) -> int:
    score = 0
    # alt coverage (25)
    if checks["alt_good"]:
        score += 25
    elif checks["alt_ok"]:
        score += 12
    # html lang (15)
    if checks["lang_good"]:
        score += 15
    elif checks["lang_ok"]:
        score += 7
    # form labels (15)
    if checks["labels_good"]:
        score += 15
    elif checks["labels_ok"]:
        score += 7
    # link/button accessible text (15)
    if checks["acc_text_good"]:
        score += 15
    elif checks["acc_text_ok"]:
        score += 7
    # Skip link (10)
    if checks["skip_link"]:
        score += 10
    # Title (10)
    if checks["title_present"]:
        score += 10
    # ARIA usage (10)
    if checks["aria_used"]:
        score += 10
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out = []
    if not checks["alt_ok"]:
        out.append(f"alt-text coverage only {raw['alt_text_coverage_avg']*100:.0f}%.")
    elif not checks["alt_good"]:
        out.append(f"alt-text coverage {raw['alt_text_coverage_avg']*100:.0f}% — close but a few missing.")
    if not checks["lang_ok"]:
        out.append(f"Only {raw['html_lang_pct']}% of pages set <html lang=\"...\">.")
    if not checks["labels_ok"]:
        out.append(f"Form fields without associated <label>: avg {raw['form_label_ratio_avg']*100:.0f}% labeled.")
    if not checks["acc_text_ok"]:
        out.append(f"Links / buttons without accessible text: avg {raw['accessible_text_pct']}%.")
    if not checks["skip_link"]:
        out.append("No skip-to-content link found — keyboard users must tab through the whole nav.")
    if not checks["title_present"]:
        out.append(f"<title> missing on {100 - raw['title_present_pct']}% of pages.")
    if not checks["aria_used"]:
        out.append("No aria-* attributes used — modern UI components are inaccessible.")
    return out
