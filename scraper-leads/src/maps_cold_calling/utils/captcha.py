"""Captcha detection — Phase 3.4.

Detects whether Google Maps (or any other page) has triggered a "unusual
traffic" / reCAPTCHA challenge. Detection **only** — no solving (per design).

Usage::

    from maps_cold_calling.utils.captcha import detect
    if await detect(page):
        LOG.warning("captcha detected; skipping")
        ...

The detector is intentionally heuristic and cheap. False positives are
acceptable for a personal-use scraper — the cost is one extra page reload
or abort. False negatives are also acceptable: retry/backoff will catch the
next "no-results" return.
"""

from __future__ import annotations

import logging

from playwright.async_api import Page

LOG = logging.getLogger(__name__)

# Each tuple = (CSS-like hint, reason for inclusion)
_SELECTORS: tuple[str, ...] = (
    "iframe[src*='recaptcha']",
    "iframe[src*='captcha']",
    "iframe[title*='reCAPTCHA' i]",
    "#rc-imageselect",
    ".g-recaptcha",
    "div[data-sitekey]",
)

# Phrases Google's "unusual traffic" interstitial uses in many languages.
# Case-insensitive substring match against visible body text.
_BODY_PHRASES: tuple[str, ...] = (
    "unusual traffic from your computer",
    "your computer or network may be sending automated queries",
    "detected unusual traffic",
    "detected automated requests",
    "automated requests from your ip",
    "пре него што наставите",  # Serbian "before you continue" — also consent banner
    "приступ блокиран",
)


async def detect(page: Page) -> bool:
    """Return True if the current page looks like a captcha / block page."""
    url = (page.url or "").lower()
    if "/sorry/" in url or "captcha" in url.split("?", 1)[0]:
        LOG.debug("captcha: detected in URL: %s", page.url)
        return True

    for sel in _SELECTORS:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                LOG.debug("captcha: detected via selector %s", sel)
                return True
        except Exception:  # noqa: BLE001 — best-effort detection
            continue

    try:
        body_text = await page.evaluate("() => document.body && document.body.innerText || ''")
    except Exception:  # noqa: BLE001
        body_text = ""
    body_low = body_text.lower()
    for phrase in _BODY_PHRASES:
        if phrase in body_low:
            LOG.debug("captcha: detected via phrase %r", phrase)
            return True

    return False


__all__ = ["detect"]
