"""Centralized Google Maps selectors with multi-candidate fallbacks.

Google frequently tweaks DOM class names (a fresh noncespaced blob each
release). Anchors are organized here as ordered lists, most-reliable first.
Each helper ``first_match(...)`` returns the first non-empty result across the
list of selectors, or ``None``.

Update strategy:
1. When extraction regresses, log which selector name failed (each fallback
   list has a stable ``field`` key).
2. Add a new candidate to the front of that list.
3. Re-run the smoke; success → done.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable, Iterable, TypeVar

from playwright.async_api import Page

LOG = logging.getLogger(__name__)

T = TypeVar("T")

# A "Candidate" is an async extractor that returns ``T | None``.
AsyncExtractor = Callable[[Page], Awaitable[T | None]]


# ───────────────────────── selector lists ─────────────────────────

# Search results page

FEED_SELECTORS: tuple[str, ...] = (
    '[role="feed"]',
    '.m6QErb[aria-label]',  # 2024 layout root
    '.section-scrollbox',   # older desktop layout
)

RESULT_ANCHOR_SELECTORS: tuple[str, ...] = (
    'a[href*="/maps/place/"]',
    'a.hfpxzc[href*="/maps/place/"]',  # legacy class
)


# Detail page — per-field selectors, most-reliable first

NAME_SELECTORS: tuple[str, ...] = (
    'h1',
    'h1.DUwDvf',
    'h1[class*="fontHeadline"]',
    'h1.qBF1Pd',
)

PHONE_BUTTON_SELECTORS: tuple[str, ...] = (
    'button[data-item-id^="phone:tel:"]',
    'button[data-item-id*="phone"]',
    'button[aria-label^="Phone:"]',
    'button[aria-label^="Телефон"]',  # Serbian Cyrillic "Telephone:"
    'button[aria-label^="Telefon"]',  # Serbian Latin
)

WEBSITE_SELECTORS: tuple[str, ...] = (
    'a[data-item-id="authority"]',
    'a.CsEnBe[data-item-id="authority"]',
    'a[aria-label^="Website"]',
)

ADDRESS_BUTTON_SELECTORS: tuple[str, ...] = (
    'button[data-item-id*="address"]',
    'button[aria-label^="Address"]',
    'button[aria-label^="Адреса"]',
)

CATEGORY_BUTTON_SELECTORS: tuple[str, ...] = (
    'button[data-item-id*="category"]',
    'button.DkFyOd[jsaction*="category"]',  # legacy
    'button[aria-label][jsaction*="category"]',
)

RATING_SELECTORS: tuple[str, ...] = (
    'span[role="img"][aria-label*="star" i]',
    'span[role="img"][aria-label*="Звездица"]',
    'span[role="img"][aria-label*="звездица"]',
    'span[role="img"][aria-label*="звез"]',
    'span.ceNzKf',                         # 2024+ rating pill
    'span.cecioK',                         # legacy
    'span[aria-label*="star" i]',
    'span[aria-label*="Звездица"]',
    'span[aria-label*="звездица"]',
)

REVIEWS_SELECTORS: tuple[str, ...] = (
    # 2025+ Maps: span[role=img] dedicated to reviews-only (next to the rating pill)
    # Owner-of-page variant: aria-label="1.911 рецензија" (lowercase Cyrillic).
    'span[role="img"][aria-label*="рецензија" i]',
    # Neighbour-place variant: aria-label="Звездица: 4,5 Рецензија: 581" (uppercase).
    'span[role="img"][aria-label*="Рецензија" i]',
    # Latin (en/sr-Latn) variants.
    'span[role="img"][aria-label*="Recenzija" i]',
    'span[role="img"][aria-label*="recenzija" i]',
    'span[role="img"][aria-label*="utisaka" i]',
    'span[role="img"][aria-label*="recenzij" i]',
    # Legacy button / pill selectors.
    'button[aria-label*="reviews" i]',
    'button[aria-label*="recenzij" i]',
    'button[aria-label*="recenzi"]',
    'button[aria-label*="рецензи"]',
    'button[aria-label*="utisak" i]',
    'button[aria-label*="utisaka"]',
    'span[aria-label*="reviews" i]',
    'span[aria-label*="recenzi"]',
    '.S9kvJb + button[aria-label]',
    'button[jsaction*="pane.rating"]',
)

DETAIL_PANEL_SELECTORS: tuple[str, ...] = (
    '[role="main"]',
    'div[aria-label*="Results"]',  # legacy
)


# ───────────────────────── helpers ─────────────────────────


async def first_attr_match(
    page: Page,
    selectors: Iterable[str],
    attr: str,
) -> str | None:
    """Try each selector; return the first non-empty attribute value.

    Within a single selector, iterate ALL matches so an empty attribute
    on element #1 doesn't hide a populated element #2.
    """
    for sel in selectors:
        try:
            loc = page.locator(sel)
            n = await loc.count()
            if n == 0:
                continue
            for i in range(n):
                value = await loc.nth(i).get_attribute(attr, timeout=1000)
                if value and value.strip():
                    return value.strip()
        except Exception:  # noqa: BLE001 — selector chain may be transient
            continue
    return None


async def first_text_match(page: Page, selectors: Iterable[str]) -> str | None:
    """Try each selector; return the first non-empty inner text."""
    for sel in selectors:
        try:
            loc = page.locator(sel)
            n = await loc.count()
            if n == 0:
                continue
            for i in range(n):
                text = await loc.nth(i).inner_text(timeout=1000)
                if text and text.strip():
                    return text.strip()
        except Exception:  # noqa: BLE001
            continue
    return None


async def first_locator(page: Page, selectors: Iterable[str]):
    """Return the first :class:`Locator` that resolves to ≥1 element, else None.

    Used when the caller needs to interact with the element (e.g., click).
    """
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            if await loc.count() > 0:
                return loc
        except Exception:  # noqa: BLE001
            continue
    return None


__all__ = [
    "FEED_SELECTORS",
    "RESULT_ANCHOR_SELECTORS",
    "DETAIL_PANEL_SELECTORS",
    "NAME_SELECTORS",
    "PHONE_BUTTON_SELECTORS",
    "WEBSITE_SELECTORS",
    "ADDRESS_BUTTON_SELECTORS",
    "CATEGORY_BUTTON_SELECTORS",
    "RATING_SELECTORS",
    "REVIEWS_SELECTORS",
    "first_attr_match",
    "first_text_match",
    "first_locator",
]
