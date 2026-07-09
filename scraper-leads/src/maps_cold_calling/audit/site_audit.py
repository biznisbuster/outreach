"""Per-site orchestrator — pulls together http_client, seo, tech, crawl,
whois_age and scoring into a single :class:`SiteAudit` row.
"""

from __future__ import annotations

import asyncio
import logging
import re
from urllib.parse import urlparse

from . import whois_age
from .crawl import (
    detect_blog_url,
    extract_internal_links_from_html,
    probe_robots_sitemap,
)
from .http_client import AuditHttp, FetchResult
from .models import SiteAudit
from .scoring import one_line_summary, score
from .seo import parse_html
from .tech import detect_in_html

LOG = logging.getLogger(__name__)


def _normalize_url(raw: str) -> str | None:
    """Best-effort URL normalization.

    Accepts bare domains (``example.com``), adds ``https://`` if missing.
    Returns ``None`` for obviously invalid input.
    """
    if not raw:
        return None
    s = raw.strip()
    if not s:
        return None
    if not re.match(r"^[a-z]+://", s, re.IGNORECASE):
        s = "https://" + s
    parsed = urlparse(s)
    if parsed.scheme not in ("http", "https"):
        return None
    if not parsed.netloc:
        return None
    return s


def _domain_of(url: str) -> str | None:
    parsed = urlparse(url)
    host = parsed.hostname
    if not host:
        return None
    return host.lower()


async def audit_one(
    url_raw: str,
    *,
    http: AuditHttp,
    skip_age: bool = False,
    concurrency_limiter: asyncio.Semaphore | None = None,
) -> SiteAudit:
    """Audit one URL end-to-end and return a populated :class:`SiteAudit`.

    ``concurrency_limiter`` is per-audit to keep the whole pipeline
    predictable. The HTTP client already enforces per-host limits.
    """
    audit = SiteAudit()
    url = _normalize_url(url_raw)
    if not url:
        audit.audit_status = "failed"
        audit.audit_error = "invalid url"
        return audit
    audit.site_url = url
    audit.site_domain = _domain_of(url)

    if concurrency_limiter is not None:
        async with concurrency_limiter:
            return await _audit_after_lock(audit, url, http, skip_age=skip_age)
    return await _audit_after_lock(audit, url, http, skip_age=skip_age)


async def _audit_after_lock(
    audit: SiteAudit,
    url: str,
    http: AuditHttp,
    *,
    skip_age: bool,
) -> SiteAudit:
    # ── 1) Homepage fetch ──
    res = await http.get(url)
    audit.site_http_status = res.status
    audit.site_response_ms = res.elapsed_ms
    audit.site_https = res.https
    audit.site_redirects = res.redirects
    if res.body is not None:
        audit.site_page_bytes = len(res.body)
    audit.site_gzip = "gzip" in (res.headers.get("content-encoding") or "").lower() or "br" in (res.headers.get("content-encoding") or "").lower()

    transport_failed = res.error is not None or (res.status is None or res.status >= 400)
    if res.error is not None:
        audit.audit_error = res.error
        LOG.warning("audit: %s -> %s", url, res.error)
    elif res.status is None or res.status >= 400:
        audit.audit_error = f"http {res.status}"

    final_url = res.url or url
    audit.site_url = final_url

    # ── Page-content analyzers (only if we got a body back) ──
    if not transport_failed and res.body:
        # ── 2) SEO + tech from homepage HTML ──
        seo = parse_html(res.body, base_url=final_url)
        audit.site_title = seo.title
        audit.site_meta_description = seo.meta_description
        audit.site_h1 = seo.h1
        audit.site_h2_count = seo.h2_count
        audit.site_canonical = seo.canonical
        audit.site_lang = seo.lang
        audit.site_og_title = seo.og_title
        audit.site_og_description = seo.og_description
        audit.site_word_count = seo.word_count
        audit.site_image_count = seo.image_count
        if seo.image_count > 0:
            audit.site_image_alt_coverage = round(seo.images_with_alt / seo.image_count, 3)
        audit.site_internal_links = seo.internal_links
        audit.site_external_links = seo.external_links

        tech = detect_in_html(res.body)
        audit.site_tech_stack = tech.tags

        # ── Blog detection hint from HTML ──
        blog_from_html = _blog_from_html(res.body, final_url)
        if blog_from_html and not audit.site_has_blog:
            audit.site_has_blog = True
            audit.site_blog_url = blog_from_html

    # ── Even when the homepage is blocked, we can still try discovery ──
    # and WHOIS — useful: blocked site + old domain is a SKIP anyway.
    try:
        has_robots, has_sitemap, sitemap_url, sitemap_entries = await probe_robots_sitemap(
            http, final_url
        )
        audit.site_has_robots = has_robots
        audit.site_has_sitemap = has_sitemap
        if sitemap_entries and sitemap_entries > 0:
            audit.site_estimated_pages = sitemap_entries
    except Exception as exc:  # noqa: BLE001
        LOG.debug("audit: discovery failed: %s", exc)

    if not audit.site_has_blog and not transport_failed:
        has_blog_disp = await detect_blog_url(http, final_url)
        if has_blog_disp:
            has_blog, blog_url = has_blog_disp
            audit.site_has_blog = has_blog
            audit.site_blog_url = blog_url

    # Page-count estimate when we have a body.
    if not transport_failed and res.body and not audit.site_estimated_pages:
        internal_count = extract_internal_links_from_html(res.body, final_url)
        if internal_count > (audit.site_internal_links or 0):
            audit.site_internal_links = internal_count
        if internal_count >= 1:
            audit.site_estimated_pages = internal_count

    # Mobile viewport meta already on SeoFields; copy through.
    if not transport_failed:
        try:
            audit.site_mobile_viewport = parse_html(res.body or b"", base_url=final_url).has_viewport
        except Exception:  # noqa: BLE001
            pass

    # ── 6) Domain age (independent of homepage success) ──
    if not skip_age and audit.site_domain:
        try:
            dom = await whois_age.lookup(audit.site_domain)
            if dom.created:
                audit.site_domain_created = dom.created
                audit.site_domain_age_years = dom.age_years
            if dom.registrar:
                audit.site_domain_registrar = dom.registrar
        except Exception as exc:  # noqa: BLE001
            LOG.debug("audit: age lookup failed: %s", exc)

    # ── 7) Score + verdict ──
    bd = score(audit)
    audit.site_score = bd.total
    audit.site_grade = bd.grade
    audit.site_verdict = bd.verdict
    audit.site_pros = bd.pros
    audit.site_cons = bd.cons
    audit.site_summary = one_line_summary(audit, bd)
    if transport_failed:
        audit.audit_status = "partial"
    else:
        audit.audit_status = "ok"
    return audit


_BLOG_HINTS_IN_HTML: tuple[str, ...] = (
    "/blog", "/vesti", "/novosti", "/clanak", "/clanci",
    "/aktuelnosti", "/publikacije", "/articles",
)


def _blog_from_html(html: bytes | None, base_url: str) -> str | None:
    """Cheap scan of the homepage HTML for blog-like anchor URLs."""
    if not html:
        return None
    try:
        text = html.decode("utf-8", errors="replace") if isinstance(html, (bytes, bytearray)) else html
    except Exception:  # noqa: BLE001
        return None
    base_host = (urlparse(base_url).hostname or "").lower()
    parsed = urlparse(base_url)
    if not base_host:
        return None
    for hint in _BLOG_HINTS_IN_HTML:
        m = re.search(
            r'href\s*=\s*["\']([^"\']*' + re.escape(hint) + r'[^"\']*)["\']',
            text,
            re.IGNORECASE,
        )
        if m:
            url = m.group(1)
            if url.startswith(("http://", "https://")):
                if base_host in url:
                    return url
            else:
                return parsed.scheme + "://" + parsed.netloc + url
    return None


__all__ = ["audit_one"]
