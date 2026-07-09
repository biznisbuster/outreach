"""Sitemap / robots / blog URL discovery.

Given a homepage URL, return:
- whether ``robots.txt`` exists
- whether ``sitemap.xml`` exists
- estimated page count (from sitemap entry count, fallback to internal link count)
- whether a blog URL exists (e.g. ``/blog``, ``/vesti``, ``/novosti``)

All probes are HEAD requests first, falling back to GET if HEAD is not
allowed (some servers reject HEAD with 4xx).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from typing import Iterable
from urllib.parse import urljoin, urlparse

from selectolax.parser import HTMLParser

from .http_client import AuditHttp, FetchResult

LOG = logging.getLogger(__name__)

# Common blog URL fragments — add new TLDs / languages here.
BLOG_FRAGMENTS: tuple[str, ...] = (
    "/blog",
    "/blogs",
    "/news",
    "/vesti",
    "/novosti",
    "/clanak",     # Serbian "article"
    "/clanci",
    "/artikli",
    "/articles",
    "/article",
    "/aktuelnosti",
    "/press",
    "/media",
    "/publikacije",
)

# Common sitemap paths probed in order (most authoritative first).
SITEMAP_PATHS: tuple[str, ...] = (
    "/sitemap.xml",
    "/sitemap_index.xml",
    "/sitemap-index.xml",
    "/sitemap/sitemap.xml",
    "/robots.txt",          # in case sitemap is referenced there
)

ROBOTS_PATH = "/robots.txt"


@dataclass
class DiscoveryResult:
    has_robots: bool = False
    has_sitemap: bool = False
    sitemap_url: str | None = None
    sitemap_entries: int = 0
    has_blog: bool = False
    blog_url: str | None = None
    internal_links: int = 0


async def _head_or_get(client: AuditHttp, url: str) -> FetchResult:
    """HEAD then GET fallback. Body is discarded for prose endpoints."""
    res = await client.head(url)
    if res.status is None or res.status >= 400 or res.body is not None and res.body == b"":
        # Some servers return 405 on HEAD. Try GET but discard body bytes
        # unless they're XML — but we only care about status here.
        get = await client.get(url)
        if get.status is not None and 200 <= get.status < 400:
            return get
    return res


async def probe_robots_sitemap(client: AuditHttp, base_url: str) -> tuple[bool, bool, str | None, int]:
    """Probe ``robots.txt`` and ``sitemap.xml``.

    Returns ``(has_robots, has_sitemap, sitemap_url, sitemap_entries)``.
    """
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"

    # robots.txt
    has_robots = False
    robots_res = await _head_or_get(client, origin + ROBOTS_PATH)
    if robots_res.status is not None and 200 <= robots_res.status < 400:
        has_robots = True

    has_sitemap = False
    sitemap_url: str | None = None
    sitemap_entries = 0

    for path in SITEMAP_PATHS:
        url = origin + path
        res = await client.get(url)
        if res.status is None or res.status >= 400 or res.body is None:
            continue
        ctype = (res.headers.get("content-type") or "").lower()
        if "xml" not in ctype and path.endswith(".xml"):
            continue
        # parse xml
        entries = _count_sitemap_entries(res.body)
        if entries > 0 or "xml" in ctype:
            has_sitemap = True
            sitemap_url = url
            sitemap_entries = entries
            break

    return has_robots, has_sitemap, sitemap_url, sitemap_entries


_SITEMAP_LOC_RE = re.compile(rb"<loc>\s*([^<]+?)\s*</loc>", re.IGNORECASE)


def _count_sitemap_entries(body: bytes) -> int:
    """Count ``<loc>`` entries in a sitemap XML body."""
    return len(_SITEMAP_LOC_RE.findall(body))


async def detect_blog_url(client: AuditHttp, base_url: str) -> tuple[bool, str | None]:
    """Try a handful of common blog path patterns. First hit wins.

    Uses a HEAD probe with GET fallback; we don't fetch the blog content.
    """
    parsed = urlparse(base_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    for frag in BLOG_FRAGMENTS:
        url = origin + frag
        res = await client.head(url)
        if res.status is None or res.status >= 400:
            res = await client.get(url)
        if res.status is not None and 200 <= res.status < 400:
            return True, url
    return False, None


def extract_internal_links_from_html(html: bytes | str | None, base_url: str) -> int:
    """Count internal anchors in the homepage HTML — used as a page-count proxy."""
    if not html:
        return 0
    try:
        text = html.decode("utf-8", errors="replace") if isinstance(html, (bytes, bytearray)) else html
    except Exception:  # noqa: BLE001
        return 0
    try:
        tree = HTMLParser(text)
    except Exception:  # noqa: BLE001
        return 0
    base_host = (urlparse(base_url).hostname or "").lower()
    if not base_host:
        return 0
    count = 0
    seen: set[str] = set()
    for a in tree.css("a[href]"):
        href = a.attributes.get("href", "")
        if not href or href.startswith(("#", "javascript:", "mailto:", "tel:")):
            continue
        full = href if bool(urlparse(href).netloc) else urljoin(base_url, href)
        host = (urlparse(full).hostname or "").lower()
        if host == base_host or host.endswith("." + base_host) or base_host.endswith("." + host):
            norm = full.split("#", 1)[0].split("?", 1)[0]
            if norm not in seen and norm != base_url:
                seen.add(norm)
                count += 1
    return count


__all__ = [
    "DiscoveryResult",
    "probe_robots_sitemap",
    "detect_blog_url",
    "extract_internal_links_from_html",
]
