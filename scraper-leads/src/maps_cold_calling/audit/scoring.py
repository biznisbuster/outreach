"""Composite quality scoring + cold-outreach verdict.

The audit row is reduced to a 0–100 score, an A–F grade, and a verdict
of ``CALL`` / ``MAYBE`` / ``SKIP`` that the user can use to triage leads.

The score weighs (in points, out of 100):

  ┌─────────────────────────────┬───────┐
  │ SEO core (title, meta, h1) │ 30    │
  │ Mobile-readiness           │ 15    │
  │ Security (HTTPS, 2xx)      │ 10    │
  │ Content depth              │ 15    │
  │ Site completeness          │ 15    │
  │ Modernity                  │ 10    │
  │ Performance                │  5    │
  └─────────────────────────────┴───────┘

Verdict logic prioritizes *opportunity for the user to win a pitch*:

  CALL  - Site has obvious gaps AND site is reachable AND (young OR no
          CMS that locks them in). The user has a fresh pitch.
  MAYBE - Site is mediocre. Could be worth a personalized email.
  SKIP  - Site is already good OR has no contactable presence OR is dead.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field

from .models import SiteAudit

LOG = logging.getLogger(__name__)


@dataclass
class ScoreBreakdown:
    seo: int = 0
    mobile: int = 0
    security: int = 0
    content: int = 0
    completeness: int = 0
    modernity: int = 0
    performance: int = 0
    total: int = 0
    grade: str = "F"
    verdict: str = "SKIP"
    pros: list[str] = field(default_factory=list)
    cons: list[str] = field(default_factory=list)


def _grade(score: int) -> str:
    if score >= 85:
        return "A"
    if score >= 70:
        return "B"
    if score >= 55:
        return "C"
    if score >= 40:
        return "D"
    return "F"


def _verdict(score: int, audit: SiteAudit) -> str:
    """Decide CALL / MAYBE / SKIP.

    A *higher* score means the site is already in better shape — so the
    pitch is harder. The verdict intentionally inverts the raw score with
    age + CMS considerations.

    Heuristic (tuned against real Beograd salon scrapes):
      score >= 80          -> SKIP  (already great, no angle)
      score 70–79          -> MAYBE (decent, personalized pitch)
      score 55–69          -> CALL if the business is a winnable pitch
                              (has a CMS they can edit, has a blog, or is
                              <=5 years old).
                              Otherwise MAYBE.
      score < 55           -> CALL if winnable pitch; else MAYBE.
      HTTP error or no title/h1 -> SKIP (can't even pitch them without a
                              working site).
    """
    tech = set(audit.site_tech_stack or [])
    has_blog = bool(audit.site_has_blog)
    has_cms_lockin = bool({"wix", "squarespace", "shopify", "wordpress", "webflow"} & tech)
    age = audit.site_domain_age_years

    # Strong negative signals — no point pitching a dead/blocked site.
    if audit.site_http_status is None or audit.site_http_status >= 400:
        return "SKIP"
    if not audit.site_title and not audit.site_h1:
        return "SKIP"

    # Already great — save your time.
    if score >= 80:
        return "SKIP"

    if score >= 70:
        return "MAYBE"

    # Below 70: by definition has gaps. Is this a winnable pitch?
    # "Winnable" = they care about their digital presence (CMS / blog)
    # OR they recently built (likely to refresh again soon).
    if has_blog or has_cms_lockin:
        return "CALL"
    if age is not None and age <= 5.0:
        return "CALL"

    # Otherwise: a mid-low score site with no CMS and no blog — could go
    # either way; treat as MAYBE so the user looks at it manually.
    return "MAYBE"


def score(audit: SiteAudit) -> ScoreBreakdown:
    """Compute the composite score + verdict for a populated audit row."""
    bd = ScoreBreakdown()
    pros: list[str] = []
    cons: list[str] = []

    tech = set(audit.site_tech_stack or [])
    has_https = bool(audit.site_https)
    has_viewport = bool(audit.site_mobile_viewport)

    # ── SEO core (30) ──
    bd.seo = 0
    if audit.site_title:
        bd.seo += 8
    else:
        cons.append("Missing <title> tag (SEO critical)")
    if audit.site_meta_description:
        bd.seo += 7
    else:
        cons.append("No meta description (Google snippets look weak)")
    if audit.site_h1:
        bd.seo += 8
    else:
        cons.append("No <h1> heading on homepage")
    if audit.site_canonical:
        bd.seo += 4
    else:
        cons.append("Missing <link rel=canonical>")
    if audit.site_lang:
        bd.seo += 3
    else:
        cons.append("Missing <html lang> attribute")
    bd.seo = min(30, bd.seo)

    # ── Mobile (15) ──
    bd.mobile = 8 if has_viewport else 0
    if not has_viewport:
        cons.append("No <meta name=viewport> (not mobile-friendly)")
    if has_viewport and "no-site-app" not in tech:
        bd.mobile += 5
    if "tailwind" in tech or "bootstrap" in tech:
        bd.mobile += 2
    bd.mobile = min(15, bd.mobile)

    # ── Security (10) ──
    bd.security = 0
    if audit.site_http_status is not None and 200 <= audit.site_http_status < 400:
        bd.security += 6
    if has_https:
        bd.security += 4
        pros.append("HTTPS on")
    else:
        cons.append("HTTPS missing (browsers warn; SEO penalty)")

    # ── Content depth (15) ──
    bd.content = 0
    wc = audit.site_word_count or 0
    if wc >= 300:
        bd.content += 8
    elif wc >= 100:
        bd.content += 4
    else:
        cons.append(f"Thin content ({wc} words on homepage)")
    h2c = audit.site_h2_count or 0
    if h2c >= 3:
        bd.content += 4
    elif h2c == 0:
        cons.append("No subheadings — page is one wall of text")
    if (audit.site_image_count or 0) >= 3:
        bd.content += 3
    bd.content = min(15, bd.content)
    if wc >= 300 and h2c >= 3:
        pros.append(f"Substantial content: {wc} words, {h2c} subheadings")

    # ── Completeness (15) ──
    bd.completeness = 0
    if audit.site_has_robots:
        bd.completeness += 3
    else:
        cons.append("No robots.txt")
    if audit.site_has_sitemap:
        bd.completeness += 4
    else:
        cons.append("No sitemap.xml")
    pages = audit.site_estimated_pages or audit.site_internal_links or 0
    if pages >= 10:
        bd.completeness += 5
        pros.append(f"Many pages discovered (~{pages})")
    elif pages >= 3:
        bd.completeness += 3
    if audit.site_has_blog:
        bd.completeness += 3
        pros.append(f"Has a blog: {audit.site_blog_url}")
    else:
        cons.append("No blog / news section found")
    bd.completeness = min(15, bd.completeness)

    # ── Modernity (10) ──
    bd.modernity = 0
    if "jquery" not in tech:
        bd.modernity += 3
    else:
        cons.append("Still on jQuery (legacy JS)")
    if {"wordpress", "shopify", "wix", "squarespace", "webflow"} & tech:
        bd.modernity += 4
        pros.append("On a CMS they could edit themselves")
    elif {"nextjs", "nuxt"} & tech:
        bd.modernity += 3
    else:
        bd.modernity += 1
    if "google_analytics" in tech:
        bd.modernity += 1
    if "facebook_pixel" in tech:
        bd.modernity += 1
    if "cloudflare" in tech:
        bd.modernity += 1
    bd.modernity = min(10, bd.modernity)

    # ── Performance (5) ──
    bd.performance = 0
    if audit.site_gzip:
        bd.performance += 2
    else:
        cons.append("No gzip/brotli compression")
    size_kb = audit.site_page_bytes // 1024 if audit.site_page_bytes else None
    if size_kb is not None:
        if size_kb < 200:
            bd.performance += 3
        elif size_kb < 500:
            bd.performance += 2
        elif size_kb < 1500:
            bd.performance += 1
        else:
            cons.append(f"Heavy homepage ({size_kb} KB)")
    bd.performance = min(5, bd.performance)

    bd.total = bd.seo + bd.mobile + bd.security + bd.content + bd.completeness + bd.modernity + bd.performance
    bd.total = max(0, min(100, bd.total))
    bd.grade = _grade(bd.total)
    bd.verdict = _verdict(bd.total, audit)
    bd.pros = pros
    bd.cons = cons
    return bd


def one_line_summary(audit: SiteAudit, bd: ScoreBreakdown) -> str:
    """A single-sentence TL;DR for the row."""
    title = (audit.site_title or "").strip()
    title_part = f' "{title[:60]}"' if title else ""
    bits: list[str] = [f"{bd.grade} ({bd.total}/100) → {bd.verdict}"]
    if audit.site_domain_age_years is not None:
        bits.append(f"{audit.site_domain_age_years:.1f}y old")
    if audit.site_estimated_pages:
        bits.append(f"~{audit.site_estimated_pages} pages")
    tech = audit.site_tech_stack or []
    if tech:
        bits.append(",".join(tech[:4]))
    return title_part + " — " + "; ".join(bits)


__all__ = ["score", "ScoreBreakdown", "one_line_summary"]
