"""Mobile-friendliness audit.

Score 0-100.
"""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class MobileResult:
    raw: dict
    score: int
    issues: list[str]


_VIEWPORT_RE = re.compile(r'<meta\b[^>]*name=["\']viewport["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE)


def audit_mobile(pages: list[dict]) -> MobileResult:
    if not pages:
        return MobileResult(raw={"empty": True}, score=0, issues=["No pages."])

    n = len(pages)

    # Viewport meta — homepage matters most but we want it on all pages
    viewport_ok = sum(1 for p in pages if _viewport_ok(p.get("html", "")))
    viewport_pct = round(viewport_ok / n * 100)

    # Responsive images (srcset/sizes/picture)
    img_total = sum(p.get("image_total", 0) for p in pages)
    img_responsive = sum(p.get("image_responsive_count", 0) for p in pages)
    resp_ratio = (img_responsive / img_total) if img_total else 1.0

    # Font-size policy — heuristic: very small base font sizes are bad
    small_font_pct = _small_base_font_pct(pages)

    # Fixed-pixel-width outer containers (overflow risk)
    fixed_width_pct = _fixed_width_pages_pct(pages)

    checks = {
        "viewport_perfect": viewport_pct == 100,
        "viewport_good": viewport_pct >= 90,
        "responsive_perfect": resp_ratio >= 0.8,
        "responsive_good": resp_ratio >= 0.5,
        "no_small_fonts": small_font_pct <= 5,
        "no_fixed_widths": fixed_width_pct <= 5,
    }

    score = _score_checks(checks)
    raw = {
        "pages_analyzed": n,
        "viewport_meta_pct": viewport_pct,
        "images_total": img_total,
        "images_responsive_count": img_responsive,
        "responsive_image_ratio": round(resp_ratio, 2),
        "small_font_pages_pct": small_font_pct,
        "fixed_width_pages_pct": fixed_width_pct,
    }
    issues = _issues_for(checks, raw)
    return MobileResult(raw=raw, score=score, issues=issues)


def _viewport_ok(html: str) -> bool:
    if not html:
        return False
    m = _VIEWPORT_RE.search(html)
    if not m:
        return False
    content = m.group(1).lower()
    # "width=device-width" is the modern standard
    return "width=device-width" in content or "width= device-width" in content


def _small_base_font_pct(pages: list[dict]) -> int:
    """% of pages whose body font-size looks <12 px in CSS."""
    bad = 0
    css_text_re = re.compile(r"font-size\s*:\s*(\d+(?:\.\d+)?)\s*px", re.IGNORECASE)
    for p in pages:
        style = p.get("inline_style", "") or ""
        for m in css_text_re.finditer(style):
            try:
                if float(m.group(1)) < 12:
                    bad += 1
                    break
            except ValueError:
                pass
    return round(bad / max(1, len(pages)) * 100)


def _fixed_width_pages_pct(pages: list[dict]) -> int:
    """% of pages that contain ``style="width:NNNpx"`` on outer containers.

    Rough heuristic — but the smallest px values 1000+ almost always mean
    ``width: 1080px`` on a wrapper, which is a desktop-only layout.
    """
    fixed_re = re.compile(r'style="[^"]*width\s*:\s*(\d{3,4})px', re.IGNORECASE)
    bad = 0
    for p in pages:
        html = p.get("html") or ""
        for m in fixed_re.finditer(html):
            try:
                if int(m.group(1)) >= 1000:
                    bad += 1
                    break
            except ValueError:
                pass
    return round(bad / max(1, len(pages)) * 100)


def _score_checks(checks: dict) -> int:
    score = 0
    # viewport (50 — this is critical for mobile)
    if checks["viewport_perfect"]:
        score += 50
    elif checks["viewport_good"]:
        score += 30
    # responsive images (30)
    if checks["responsive_perfect"]:
        score += 30
    elif checks["responsive_good"]:
        score += 14
    # font size (10)
    if checks["no_small_fonts"]:
        score += 10
    # No fixed widths (10)
    if checks["no_fixed_widths"]:
        score += 10
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out = []
    if not checks["viewport_good"]:
        out.append(f"Missing/incorrect viewport meta on {100 - raw['viewport_meta_pct']}% of pages.")
    elif not checks["viewport_perfect"]:
        out.append(f"Viewport meta present on {raw['viewport_meta_pct']}% of pages.")
    if not checks["responsive_good"]:
        out.append(f"Only {raw['responsive_image_ratio']*100:.0f}% of <img> use srcset/sizes/<picture>.")
    elif not checks["responsive_perfect"]:
        out.append(f"{raw['responsive_image_ratio']*100:.0f}% of images are responsive — workable but not great.")
    if not checks["no_small_fonts"]:
        out.append(f"{raw['small_font_pages_pct']}% of pages have <12 px font size somewhere.")
    if not checks["no_fixed_widths"]:
        out.append(f"{raw['fixed_width_pages_pct']}% of pages have fixed-width containers (>=1000px) — won't fit on phones.")
    return out
