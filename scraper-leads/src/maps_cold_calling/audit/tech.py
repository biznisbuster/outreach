"""Tech-stack detection from raw HTML.

Heuristic, signal-based. Returns a sorted list of canonical tags — never
fails. Tag set is biased toward platforms relevant for cold-outreach
positioning (WordPress / Wix / Squarespace / Shopify) and toward legacy
indicators (jQuery v1, no gzip) that signal a website likely to need an
update.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from selectolax.parser import HTMLParser


# Each entry: (canonical tag, tuple of substrings; any match wins).
# NOTE: 1-element tuples MUST have a trailing comma — otherwise the value is
# a plain string and ``for needle in needles`` iterates over characters.
_SIGNATURES: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("wordpress", (
        "/wp-content/", "/wp-includes/", "/wp-json/", "wp-emoji", "wp-block",
    )),
    ("shopify", ("cdn.shopify.com", "shopify.com/s/files", ".myshopify.com")),
    ("wix", ("static.wixstatic.com", "wix.com", "_wix_browser")),
    ("squarespace", ("squarespace.com", "static.squarespace.com")),
    ("joomla", ("/components/com_", "joomla", "<meta name=\"generator\" content=\"Joomla")),
    ("drupal", ("/sites/default/files", "<meta name=\"Generator\" content=\"Drupal")),
    ("ghost", ("ghost.io", "/ghost/api/")),
    ("webflow", ("webflow.com", "uploads.webflow.com")),
    # frameworks
    ("nextjs", ("/_next/", "__NEXT_DATA__")),
    ("nuxt", ("/_nuxt/",)),
    ("react", ("react.development.js", "react.production.min.js")),
    ("vue", ("vue.runtime", "/js/vue")),
    ("bootstrap", ("bootstrap.css", "bootstrap.min.css", "bootstrap.min.js")),
    ("tailwind", ("tailwind.css", "tailwindcss", "tailwind.min.css")),
    ("jquery", ("jquery.min.js", "jquery.js", "/jquery-", "var jQuery")),
    # tools / trackers
    ("google_analytics", ("google-analytics.com", "gtag(", "googletagmanager.com")),
    ("gtm", ("googletagmanager.com",)),
    ("facebook_pixel", ("connect.facebook.net", "fbevents.js")),
    ("cloudflare", ("cf-ray", "/cdn-cgi/",)),
    ("recaptcha", ("recaptcha", "google.com/recaptcha")),
)


@dataclass
class TechSignals:
    tags: list[str] = field(default_factory=list)
    has_generator_meta: str | None = None  # raw content of <meta name="generator">
    has_jquery_old: bool = False           # jQuery 1.x detected (legacy)


def detect_in_html(raw: bytes | str | None) -> TechSignals:
    if not raw:
        return TechSignals()
    try:
        html = raw.decode("utf-8", errors="replace") if isinstance(raw, (bytes, bytearray)) else raw
    except Exception:  # noqa: BLE001
        return TechSignals()

    out = TechSignals()

    # Cheap substring scan for stack signatures (every tag is independent)
    html_low = html.lower()
    for tag, needles in _SIGNATURES:
        for needle in needles:
            if needle.lower() in html_low:
                out.tags.append(tag)
                break

    # HTML parse for generator meta + jquery version detection
    try:
        tree = HTMLParser(html)
    except Exception:  # noqa: BLE001
        tree = None

    if tree is not None:
        for meta in tree.css("meta"):
            name = meta.attributes.get("name", "").lower()
            if name == "generator":
                content = meta.attributes.get("content")
                if content:
                    out.has_generator_meta = content.strip()[:120]

        if "jquery" in out.tags:
            # Look for jquery version in <script src> hints
            for s in tree.css("script[src]"):
                src = s.attributes.get("src", "")
                m = re.search(r"jquery[-._/]?(\d+)\.(\d+)", src)
                if m:
                    major = int(m.group(1))
                    if major <= 2 and int(m.group(2)) < 3:
                        out.has_jquery_old = True
                    break

    # De-duplicate tags preserving first-seen order
    seen: set[str] = set()
    unique: list[str] = []
    for t in out.tags:
        if t not in seen:
            unique.append(t)
            seen.add(t)
    out.tags = unique

    return out


__all__ = ["detect_in_html", "TechSignals"]
