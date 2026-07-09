"""Playwright browser launcher with stealth.

The default stealth tier is ``lite`` which applies the ``playwright-stealth``
plugin and matches locale/timezone to the requested language. Heavier tiers
(char-by-char typing, scroll jitter, proxy rotation) are wired in Phase 3.
"""

from __future__ import annotations

import logging
import os
import random
from contextlib import asynccontextmanager
from typing import AsyncIterator

from playwright.async_api import Browser, BrowserContext, async_playwright
from playwright_stealth import Stealth

LOG = logging.getLogger(__name__)

# A small but realistic desktop-Chrome UA pool. Picked at random per session.
UA_POOL: tuple[str, ...] = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36",
)

LOCALE_FOR_LANG: dict[str, str] = {
    "sr": "sr-RS",
    "en": "en-US",
    "de": "de-DE",
}

# Country code → IANA timezone
TIMEZONE_FOR_COUNTRY: dict[str, str] = {
    "RS": "Europe/Belgrade",
    "US": "America/New_York",
    "DE": "Europe/Berlin",
}


def _pick_ua() -> str:
    return random.choice(UA_POOL)


def _resolve_proxy(proxy_cli: str | None) -> str | None:
    if proxy_cli:
        return proxy_cli
    return os.environ.get("MAPS_PROXY") or None


def _redact(url: str) -> str:
    if "@" in url:
        return url.split("@", 1)[0].rstrip(":") + "@***"
    return url


@asynccontextmanager
async def browser_session(
    *,
    stealth_tier: str = "lite",
    proxy: str | None = None,
    headless: bool = True,
    language: str = "sr",
    country: str = "RS",
) -> AsyncIterator[tuple[Browser, BrowserContext, Stealth]]:
    """Open a Chromium ``Browser`` + fresh ``BrowserContext`` with stealth.

    Yields ``(browser, context, stealth)``. ``stealth`` is a Stealth instance —
    call ``stealth.apply_stealth_async(context)`` once per context (already
    called by this manager when ``stealth_tier != 'off'``).

    Use as::

        async with browser_session(...) as (browser, context, stealth):
            page = await context.new_page()
            ...
    """
    resolved_proxy = _resolve_proxy(proxy)
    if resolved_proxy:
        LOG.info("browser: using proxy=%s", _redact(resolved_proxy))

    async with async_playwright() as p:
        launch_kwargs: dict = {"headless": headless}
        if resolved_proxy:
            launch_kwargs["proxy"] = {"server": resolved_proxy}
        browser = await p.chromium.launch(**launch_kwargs)
        try:
            context = await browser.new_context(
                locale=LOCALE_FOR_LANG.get(language, "en-US"),
                timezone_id=TIMEZONE_FOR_COUNTRY.get(country.upper(), "Europe/Belgrade"),
                viewport={"width": 1280, "height": 800},
                user_agent=_pick_ua(),
            )
            stealth = Stealth()
            if stealth_tier != "off":
                await stealth.apply_stealth_async(context)
            yield browser, context, stealth
        finally:
            try:
                await browser.close()
            except Exception:  # noqa: BLE001 — best effort cleanup
                LOG.warning("browser close raised; ignoring", exc_info=True)
