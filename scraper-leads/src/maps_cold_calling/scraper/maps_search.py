"""Google Maps search results scraper.

Phase 2.1 — refactored to use ``utils/selectors.py`` fallbacks. Smart
scrolling (Phase 2.5) still pending.
"""

from __future__ import annotations

import asyncio
import logging
import re
from typing import Any
from urllib.parse import quote_plus

from playwright.async_api import Page

from maps_cold_calling.utils.selectors import (
    FEED_SELECTORS,
    RESULT_ANCHOR_SELECTORS,
    first_locator,
)

LOG = logging.getLogger(__name__)

_PLACE_ID_RE = re.compile(r"(ChI[A-Za-z0-9_\-]+)")
_FEED_RATING_RE = re.compile(r"(\d+[.,]\d+)\s*\((\d[\d ]*)\)")

# Consent banner — Google's "Before you continue" / "Пре него што наставите".
CONSENT_ACCEPT_SELECTORS: tuple[str, ...] = (
    'button[aria-label*="Agree"]',
    'button[aria-label*="Прихвати"]',
    'button[aria-label*="Prihvati"]',
    'form[action*="consent"] button',
    'button:has-text("Прихватам")',
    'button:has-text("I agree")',
    'button:has-text("Agree")',
)


async def _dismiss_consent(page: Page) -> None:
    """Click 'I agree' on the consent banner if present; ignore if not."""
    btn = await first_locator(page, CONSENT_ACCEPT_SELECTORS)
    if btn is None:
        LOG.debug("consent: no banner detected (ok)")
        return
    try:
        await btn.click()
        LOG.debug("consent: dismissed")
        await page.wait_for_load_state("domcontentloaded")
    except Exception:  # noqa: BLE001 — best-effort
        LOG.debug("consent: click failed; continuing")


def build_search_url(category: str, city: str, *, language: str, country: str) -> str:
    """Compose the Google Maps search URL (Unicode-safe).

    Ako je city prazan, search query bude samo category (bez trailing space).
    Ovo omogućava novi mod gde GUI šalje ceo search string kao category
    (npr. "cvecare beograd") a city ostaje "".
    """
    parts = [category.strip()] if category else []
    if city and city.strip():
        parts.append(city.strip())
    q = quote_plus(" ".join(parts))
    return (
        f"https://www.google.com/maps/search/{q}/"
        f"?hl={language}&gl={country.upper()}&entry=co"
    )


# A JS snippet that, given an anchor element, returns the visible card text
# for the surrounding result card. Used to enrich place URLs with details
# shown in the search feed (rating, review count, category).
CARD_TEXT_JS = r"""el => {
    // Walk up to find the result card container.
    let card = el;
    for (let i = 0; i < 8 && card; i++) {
        if (card.matches('div[jsdata], div.Nv2PK, div[role="article"]')) break;
        card = card.parentElement;
    }
    if (!card) return '';
    const text = (card.innerText || '').replace(/\s+/g, ' ').trim();
    return text;
}"""


def _parse_feed_card(text: str | None) -> dict[str, Any]:
    """Extract rating/reviews/category from a search-feed card's plain text.

    Examples:
        "Frizerski Studio Fantastiko 4,7(53) Фризерски салон · Стевана Синђелића 5"
        "DAKI -M 4,9(370) Берберница · Константина Филозофа 4/2"

    The numbers may use comma as decimal (Serbian UI), so we accept both.
    Returns an empty dict on garbage input.
    """
    if not text:
        return {}
    info: dict[str, Any] = {}
    m = _FEED_RATING_RE.search(text)
    if m:
        try:
            info["rating"] = float(m.group(1).replace(",", "."))
            info["reviews_count"] = int(re.sub(r"[^\d]", "", m.group(2)))
        except ValueError:
            pass
    return info


async def _scroll_feed_until_stable(
    page: Page,
    *,
    max_results: int | None,
    idle_timeout_s: float = 30.0,
    step_pause_s: float = 0.7,
    hard_cap_s: float = 600.0,
    progress_every: int = 10,
) -> dict[str, dict[str, Any]]:
    """Scroll the feed until it stops growing, returning the URL→extras map.

    Why this is more thorough than the original v1:
      * Maps 2024/2025/2026 loads cards in *bursts* — a few cards appear,
        the DOM goes quiet for 5–15 seconds, then a larger batch lands.
        An 8-second idle timeout (the v1 default) bails out at the first
        pause and misses 20–40% of results. The v2 default of 30s tolerates
        the longer pauses we observe on real Serbian queries.
      * Each iteration tries FOUR scroll mechanisms, not one: a direct
        ``scrollTop = scrollHeight`` on the feed element, a real mouse
        wheel over the feed, an ``End`` keypress, and a click on
        any "see more" / "Више резултата" link if it appears. Each Maps
        layout only triggers on a specific event, so all four are needed.
      * Progress is logged every ``progress_every`` iterations so the user
        sees the count climbing.
      * Hard cap of ``hard_cap_s`` (default 10 min) as a safety against
        infinite-scroll pathologies.

    Returns a dict ``{"urls": [...], "extras": {url: {rating, reviews_count}}}``.
    """
    collected_urls: list[str] = []
    seen: set[str] = set()
    seen_place_ids: set[str] = set()
    extra: dict[str, dict[str, Any]] = {}
    last_growth = asyncio.get_event_loop().time()
    start = last_growth
    last_count = 0
    iter_idx = 0

    # Local selector list. Kept inline so a future refactor can extend it
    # without changing the public signature.
    scrollable_selectors = list(FEED_SELECTORS) + ["[role=\"feed\"]", "div.m6QErb", ".section-scrollbox"]

    while True:
        result_selectors = ", ".join(RESULT_ANCHOR_SELECTORS)
        rows: list[dict[str, Any]] = await page.eval_on_selector_all(
            result_selectors,
            r"""els => els.map(el => {
                let card = el.parentElement;
                while (card && card.innerText.length < 80) card = card.parentElement;
                return {
                    href: el.href,
                    text: card ? (card.innerText || "").replace(/\s+/g, " ").trim() : ""
                };
            })""",
        )
        for row in rows or []:
            href = row.get("href") if isinstance(row, dict) else None
            text = row.get("text") or "" if isinstance(row, dict) else ""
            if not href:
                continue
            pid_m = _PLACE_ID_RE.search(href)
            pid = pid_m.group(1) if pid_m else None
            if pid:
                if pid in seen_place_ids:
                    continue
                seen_place_ids.add(pid)
            elif href in seen:
                continue
            else:
                seen.add(href)
            collected_urls.append(href)
            extras = _parse_feed_card(text)
            if extras:
                extra[href] = extras

        now = asyncio.get_event_loop().time()
        if len(collected_urls) != last_count:
            last_growth = now
            last_count = len(collected_urls)
        iter_idx += 1

        # Periodic progress so the user sees the count climb on long runs.
        if iter_idx == 1 or iter_idx % progress_every == 0:
            LOG.info(
                "scroll: iter=%d count=%d idle=%.1fs elapsed=%.1fs",
                iter_idx,
                len(collected_urls),
                now - last_growth,
                now - start,
            )

        if max_results and len(collected_urls) >= max_results:
            LOG.info("scroll: cap reached at %d (max_results=%d)", len(collected_urls), max_results)
            break

        if now - last_growth > idle_timeout_s:
            LOG.info(
                "scroll: idle %.1fs with no new results — stopping at %d (after %d iterations, %.1fs elapsed)",
                idle_timeout_s,
                len(collected_urls),
                iter_idx,
                now - start,
            )
            break

        if now - start > hard_cap_s:
            LOG.warning(
                "scroll: %.0fs hard cap reached at %d — stopping",
                hard_cap_s,
                len(collected_urls),
            )
            break

        # ── Scroll: try 4 different mechanisms ──
        # (a) direct DOM scroll on the feed element
        feed = await first_locator(page, scrollable_selectors)
        if feed is not None:
            try:
                await feed.evaluate("el => { el.scrollTop = el.scrollHeight; }")
            except Exception:  # noqa: BLE001
                pass

        # (b) real mouse wheel over the feed (Maps triggers virtual-list
        #     loading in response to wheel events, not just scrollTop)
        try:
            if feed is not None:
                box = await feed.bounding_box()
                if box:
                    await page.mouse.move(
                        box["x"] + box["width"] / 2,
                        box["y"] + box["height"] * 0.7,
                    )
                    await page.mouse.wheel(0, 3000)
        except Exception:  # noqa: BLE001
            pass

        # (c) keyboard End to jump to the very bottom
        try:
            await page.keyboard.press("End")
        except Exception:  # noqa: BLE001
            pass

        # (d) click any "see more results" link if Maps has rendered one
        for sel in (
            'button:has-text("Више резултата")',
            'button:has-text("More results")',
            'button:has-text("Прикажи још")',
            'button:has-text("Show more")',
            'button:has-text("Load more")',
        ):
            try:
                btn = page.locator(sel).first
                if await btn.count() > 0:
                    await btn.click(timeout=2000)
                    LOG.debug("scroll: clicked %s", sel)
                    break
            except Exception:  # noqa: BLE001
                pass

        await asyncio.sleep(step_pause_s)

    return {"urls": collected_urls, "extras": extra}


async def collect_initial_results(
    page: Page,
    category: str,
    city: str,
    *,
    language: str,
    country: str,
    max_results: int | None = None,
    timeout_ms: int = 15_000,
    idle_timeout_s: float = 30.0,
    hard_cap_s: float = 600.0,
) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Navigate to the search URL and return unique place-detail URLs.

    When ``max_results`` is provided, scrolling stops as soon as the cap is
    reached. When ``None``, scrolls until no new cards appear for
    ``idle_timeout_s`` (default 30s — Maps loads in bursts of 5–15s
    followed by quiet periods).

    The Maps 2024/2025/2026 feed does NOT render an explicit
    "end of list" marker, so we rely on the idle timeout + a hard cap
    (``hard_cap_s``) as the only safety against infinite scroll.
    """
    url = build_search_url(category, city, language=language, country=country)
    LOG.info("maps: GET %s", url)
    await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)

    await _dismiss_consent(page)

    # Explicit wait — ``first_locator`` returns immediately even if Maps is
    # still painting. Without this, throttled sessions fail with a false
    # "feed not found" because the page hasn't fully loaded yet.
    try:
        await page.wait_for_selector(FEED_SELECTORS[0], timeout=timeout_ms)
    except Exception:
        # First selector timed out — try the others via first_locator before
        # giving up.
        if await first_locator(page, FEED_SELECTORS) is None:
            LOG.warning("maps: feed selector not found in %dms — captcha or non-Maps response", timeout_ms)
            raise RuntimeError("maps feed not found")

    await asyncio.sleep(1.0)  # initial paint settle

    LOG.info(
        "scroll: starting (max=%s, idle_timeout=%.0fs, hard_cap=%.0fs)",
        max_results,
        idle_timeout_s,
        hard_cap_s,
    )
    urls_res = await _scroll_feed_until_stable(
        page,
        max_results=max_results,
        idle_timeout_s=idle_timeout_s,
        hard_cap_s=hard_cap_s,
    )
    urls = urls_res["urls"]
    extras = urls_res["extras"]
    LOG.info(
        "scroll: done — %d unique place URLs (extras for %d)",
        len(urls),
        len(extras),
    )
    return urls, extras


__all__ = ["build_search_url", "collect_initial_results"]
