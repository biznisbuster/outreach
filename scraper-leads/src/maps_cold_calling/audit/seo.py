"""SEO extraction — pure-Python parsing on raw HTML.

Returns a dict of SEO fields. Designed to be cheap to call on every
homepage. Uses :mod:`selectolax` for fast HTML parsing; falls back to regex
or empty values when something is missing.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urljoin, urlparse

from selectolax.parser import HTMLParser

LOG = logging.getLogger(__name__)

_META_NAME_RE = re.compile(r"^\s*(\w[\w\-:.]*)\s*$")


@dataclass
class SeoFields:
    title: str | None = None
    meta_description: str | None = None
    h1: str | None = None
    h2_count: int = 0
    canonical: str | None = None
    lang: str | None = None
    og_title: str | None = None
    og_description: str | None = None
    word_count: int = 0
    image_count: int = 0
    images_with_alt: int = 0
    internal_links: int = 0
    external_links: int = 0
    has_viewport: bool = False
    headings: list[str] = field(default_factory=list)
    body_excerpt: str | None = None
    text_summary: str | None = None  # generated summary of first ~500 words


def _clean_text(s: str | None) -> str | None:
    if s is None:
        return None
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def _extract_text_excerpt(s: str, max_words: int = 80) -> str:
    """Take the first N words of a chunk of text, cleaning whitespace."""
    words = re.split(r"\s+", s.strip())
    return " ".join(words[:max_words])


def _summary_from_headings(headings: list[str], body_excerpt: str | None, word_count: int = 0) -> str:
    """Generate a one-paragraph human-readable description of what the page is about.

    Headings are the primary signal. The body excerpt is only used as a
    trailing phrase when:
      - there is at least one heading, AND
      - the body has 30+ words (i.e. it isn't a thin "Loading..." stub).
    """
    pieces: list[str] = []
    if headings:
        # Dedupe while preserving order
        seen: set[str] = set()
        for h in headings:
            h = _clean_text(h)
            if h and h.lower() not in seen:
                pieces.append(h)
                seen.add(h.lower())
    if body_excerpt and word_count >= 30:
        excerpt = _clean_text(body_excerpt)
        if excerpt:
            pieces.append(excerpt)
    if not pieces:
        return ""
    # Cap to ~3 heading phrases + 1 body sentence
    head = pieces[:3]
    body = pieces[3] if len(pieces) > 3 else ""
    if body:
        text = " · ".join(head) + ". " + body
    else:
        text = " · ".join(head)
    return text[:600].rstrip()


def parse_html(raw: bytes | str | None, base_url: str = "") -> SeoFields:
    """Parse raw HTML (bytes or str) and return a populated :class:`SeoFields`."""
    if not raw:
        return SeoFields()
    try:
        html = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else raw
    except Exception:  # noqa: BLE001
        return SeoFields()
    try:
        tree = HTMLParser(html)
    except Exception:  # noqa: BLE001
        return SeoFields()

    out = SeoFields()

    # ── title ──
    title_node = tree.css_first("title")
    if title_node is not None:
        out.title = _clean_text(title_node.text())

    # ── meta description / viewport / og:* / lang ──
    for meta in tree.css("meta"):
        name = meta.attributes.get("name", "").lower()
        prop = meta.attributes.get("property", "").lower()
        content = meta.attributes.get("content")
        if not content:
            continue
        if prop == "og:title":
            out.og_title = _clean_text(content)
        elif prop == "og:description":
            out.og_description = _clean_text(content)
        elif name == "description" and not out.meta_description:
            out.meta_description = _clean_text(content)
        elif name == "viewport":
            out.has_viewport = True

    # ── canonical ──
    canon = tree.css_first('link[rel="canonical"]')
    if canon is not None:
        href = canon.attributes.get("href")
        if href:
            out.canonical = href if bool(urlparse(href).netloc) else urljoin(base_url, href)

    # ── lang attribute on <html> ──
    html_node = tree.css_first("html")
    if html_node is not None:
        lang = html_node.attributes.get("lang")
        if lang:
            out.lang = lang.strip()[:10]

    # ── h1, h2s ──
    h1 = tree.css_first("h1")
    if h1 is not None:
        out.h1 = _clean_text(h1.text())
    h2s = tree.css("h2")
    out.h2_count = len(h2s)
    for h in h2s[:8]:
        t = _clean_text(h.text())
        if t:
            out.headings.append(t)

    # ── images & alt coverage ──
    imgs = tree.css("img")
    out.image_count = len(imgs)
    for img in imgs:
        alt = img.attributes.get("alt")
        if alt is not None and alt.strip():
            out.images_with_alt += 1

    # ── links: internal vs external ──
    base_host = (urlparse(base_url).hostname or "").lower() if base_url else ""
    for a in tree.css("a[href]"):
        href = a.attributes.get("href", "")
        if not href or href.startswith("#") or href.startswith("javascript:") or href.startswith("mailto:"):
            continue
        href_full = href if bool(urlparse(href).netloc) else urljoin(base_url, href)
        host = (urlparse(href_full).hostname or "").lower()
        if not host:
            out.internal_links += 1
        elif base_host and host == base_host:
            out.internal_links += 1
        elif base_host and (host.endswith("." + base_host) or base_host.endswith("." + host)):
            out.internal_links += 1
        else:
            out.external_links += 1

    # ── word count from main text (body, minus scripts/styles) ──
    for tag_name in ("script", "style", "noscript", "template"):
        for node in tree.css(tag_name):
            node.decompose()
    body_text = tree.body.text(separator=" ", strip=True) if tree.body is not None else ""
    body_text = re.sub(r"\s+", " ", body_text).strip()
    if body_text:
        out.word_count = len(body_text.split())
        out.body_excerpt = _extract_text_excerpt(body_text, max_words=80)
    out.text_summary = _summary_from_headings(out.headings, out.body_excerpt, word_count=out.word_count)

    return out


__all__ = ["parse_html", "SeoFields"]
