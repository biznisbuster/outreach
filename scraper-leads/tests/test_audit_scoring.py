"""Tests for the scoring + verdict logic (no network)."""

from __future__ import annotations

from maps_cold_calling.audit.models import SiteAudit
from maps_cold_calling.audit.scoring import _verdict, one_line_summary, score


def test_perfect_site_scores_high_and_is_skip():
    a = SiteAudit(
        audit_status="ok",
        site_url="https://example.com",
        site_http_status=200,
        site_https=True,
        site_title="Great Site",
        site_meta_description="A wonderful website with everything you need.",
        site_h1="Welcome",
        site_h2_count=4,
        site_canonical="https://example.com/",
        site_lang="en",
        site_word_count=900,
        site_image_count=5,
        site_image_alt_coverage=1.0,
        site_has_robots=True,
        site_has_sitemap=True,
        site_estimated_pages=40,
        site_has_blog=True,
        site_blog_url="https://example.com/blog",
        site_mobile_viewport=True,
        site_tech_stack=["google_analytics", "cloudflare"],
        site_internal_links=12,
        site_domain_age_years=5.0,
        site_gzip=True,
        site_page_bytes=80_000,
    )
    bd = score(a)
    assert bd.total >= 80
    assert bd.grade in ("A", "B")
    # Even a great site is a SKIP if there's no obvious angle.
    assert bd.verdict == "SKIP"
    assert any("HTTPS" in p for p in bd.pros)


def test_terrible_site_scores_low():
    a = SiteAudit(
        audit_status="ok",
        site_url="http://oldsite.example.com",
        site_http_status=200,
        site_https=False,
        site_word_count=80,
        site_image_count=0,
        site_estimated_pages=1,
        site_has_blog=False,
        site_tech_stack=["jquery"],
        site_mobile_viewport=False,
        site_domain_age_years=12.0,
        site_gzip=False,
        site_page_bytes=200_000,
    )
    bd = score(a)
    assert bd.total <= 50
    assert bd.grade in ("D", "F")
    # Without blog and CMS, and old site → MAYBE (not CALL)
    assert bd.verdict in ("MAYBE", "SKIP")


def test_young_blogless_site_earns_call():
    a = SiteAudit(
        audit_status="ok",
        site_url="https://youngsite.example.com",
        site_http_status=200,
        site_https=True,
        site_title="Young Site",
        site_h1="Welcome",
        site_word_count=120,
        site_image_count=2,
        site_estimated_pages=1,
        site_has_blog=False,
        site_tech_stack=[],
        site_mobile_viewport=False,
        site_domain_age_years=1.0,
        site_gzip=False,
        site_page_bytes=50_000,
    )
    bd = score(a)
    assert bd.verdict == "CALL"
    assert any("viewport" in c.lower() and "mobile" in c.lower() for c in bd.cons)


def test_400_status_forces_skip():
    a = SiteAudit(site_http_status=500, site_title="Crash")
    assert _verdict(50, a) == "SKIP"


def test_one_line_summary_format():
    a = SiteAudit(
        site_title="Salon Foo",
        site_h1="Welcome",
        site_http_status=200,
        site_word_count=120,
        site_image_count=2,
        site_estimated_pages=3,
        site_domain_age_years=2.5,
        site_tech_stack=["jquery", "google_analytics"],
    )
    bd = score(a)
    s = one_line_summary(a, bd)
    assert '"Salon Foo"' in s
    assert bd.verdict in ("CALL", "MAYBE", "SKIP")
    assert bd.grade in s
    assert "2.5y" in s
