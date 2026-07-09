"""Exhaustive diagnostic: how many results does Maps actually have for a query?

What this does:
1. Opens Maps for the given query.
2. Scrolls the result feed EXHAUSTIVELY — multiple scroll strategies, much
   longer than the production scraper's 8-second idle.
3. Pulls place IDs from EVERY possible anchor/result container in the page,
   not just the `[role="feed"]` we currently rely on.
4. Reports the count from each strategy so we can see what's being missed.

Usage::

    uv run python scripts/diag_search_exhaustive.py restorani Kruševac
    uv run python scripts/diag_search_exhaustive.py restorani Kruševac --headless
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path
from urllib.parse import quote_plus

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from playwright.async_api import async_playwright

from maps_cold_calling.scraper.browser import browser_session

# -- All selectors that might contain a place result ---------------------------
ALL_ANCHOR_SELECTORS = [
    'a[href*="/maps/place/"]',
    'a[href*="place_id:"]',
    'a[href*="!3m2!3m1"]',                # legacy maps data blob
    'div[role="article"] a[href*="google.com/maps"]',
    '[data-result-index] a',
    'a[jsaction*="pane"]',
    'a[aria-label][href*="maps"]',
]


async def _collect_pids(page) -> set[str]:
    """Return set of place-IDs found in the page using all known selectors."""
    import re
    seen: set[str] = set()
    for sel in ALL_ANCHOR_SELECTORS:
        try:
            hrefs = await page.eval_on_selector_all(
                sel, "els => els.map(e => e.href || '')",
            )
        except Exception:
            continue
        for h in hrefs:
            if not h:
                continue
            m = re.search(r'(ChI[A-Za-z0-9_\-]+)', h)
            if m:
                seen.add(m.group(1))
    # Also scrape the rendered text for `1sChIJ…` patterns (some are in data attrs)
    try:
        html = await page.content()
        for m in re.finditer(r'(ChI[A-Za-z0-9_\-]{8,})', html):
            seen.add(m.group(1))
    except Exception:
        pass
    return seen


async def main(query: str, city: str, headless: bool = True) -> int:
    url = f"https://www.google.com/maps/search/{quote_plus(f'{query} {city}')}/?hl=sr&gl=RS"
    print(f"URL: {url}\n")

    out_dir = ROOT / "scripts" / "_diag"
    out_dir.mkdir(exist_ok=True)

    async with browser_session(stealth_tier="off", headless=headless, language="sr", country="RS") as (_b, ctx, _s):
        page = await ctx.new_page()
        print(f"opening: {url}")
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)

        # Try to dismiss the consent banner
        for sel in [
            'button[aria-label*="Прихвати"]',
            'button[aria-label*="Agree"]',
            'button:has-text("Прихватам")',
        ]:
            btn = page.locator(sel).first
            if await btn.count() > 0:
                try:
                    await btn.click()
                    await asyncio.sleep(1.0)
                    print(f"dismissed consent via {sel}")
                    break
                except Exception:
                    pass

        await asyncio.sleep(2.0)
        print(f"title: {await page.title()!r}\n")

        # Strategy A: scroll the [role="feed"] element, the way the production scraper does
        # Strategy B: scroll the whole window
        # Strategy C: click "end of list" / "see more" if present
        all_seen: set[str] = set()
        log: list[dict] = []

        for i in range(60):  # up to 60 iterations of scroll-and-count
            # 1. Snapshot current
            pids = await _collect_pids(page)
            new = pids - all_seen
            step = {
                "iter": i,
                "total_unique": len(pids),
                "new_this_iter": len(new),
                "added": sorted(new)[:5],
            }
            log.append(step)
            print(f"  iter {i:>2}: total={len(pids):>3}  new={len(new):>3}  first new={sorted(new)[:3]}")
            all_seen.update(pids)

            if i > 0 and len(new) == 0:
                # No new results in this iteration — try harder once more
                if i > 5:
                    print("\n  no new results for 5+ iterations — likely at end of list")
                    break

            # 2. Try multiple scroll strategies
            # (a) feed element scroll
            try:
                await page.evaluate("""
                    () => {
                        const feed = document.querySelector('[role="feed"]');
                        if (feed) {
                            feed.scrollTop = feed.scrollHeight;
                        }
                    }
                """)
            except Exception:
                pass
            # (b) mouse wheel on the feed (Maps needs real wheel events sometimes)
            try:
                feed = page.locator('[role="feed"]').first
                if await feed.count() > 0:
                    box = await feed.bounding_box()
                    if box:
                        await page.mouse.move(box['x'] + box['width'] / 2, box['y'] + box['height'] * 0.7)
                        await page.mouse.wheel(0, 2500)
            except Exception:
                pass
            # (c) keyboard End to skip to bottom
            try:
                await page.keyboard.press("End")
            except Exception:
                pass
            # (d) click "see more" / "more results" link if present
            try:
                for sel in [
                    'button:has-text("Више резултата")',
                    'button:has-text("More results")',
                    'button:has-text("Прикажи још")',
                    'button:has-text("Show more")',
                ]:
                    btn = page.locator(sel).first
                    if await btn.count() > 0:
                        await btn.click()
                        print(f"  -> clicked '{sel}'")
                        await asyncio.sleep(1)
                        break
            except Exception:
                pass

            await asyncio.sleep(0.6)

        # Final count
        pids = await _collect_pids(page)
        all_seen.update(pids)

        # Save artifacts
        html_path = out_dir / "page_exhaustive.html"
        html_path.write_text(await page.content(), encoding="utf-8")
        url_final = page.url
        (out_dir / "url_final.txt").write_text(url_final, encoding="utf-8")

        # Look for the "end of list" marker
        body_text = await page.evaluate("() => document.body.innerText")
        end_marker = ""
        for marker in [
            "Крај листе",
            "You've reached the end",
            "Крај резултата",
            "Нема више резултата",
            "No more results",
            "end of the list",
        ]:
            if marker.lower() in body_text.lower():
                end_marker = marker
                break

        print()
        print("=" * 70)
        print(f"FINAL: {len(all_seen)} unique place-IDs found")
        print(f"end-of-list marker present: {end_marker or 'NOT FOUND'}")
        print(f"html saved: {html_path}  ({html_path.stat().st_size} bytes)")
        print(f"final URL:  {url_final}")
        print()
        print("Sample place IDs:")
        for pid in sorted(all_seen)[:20]:
            print(f"  {pid}")

    return 0


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "restorani"
    c = sys.argv[2] if len(sys.argv) > 2 else "Kruševac"
    h = "--headless" not in sys.argv
    raise SystemExit(asyncio.run(main(q, c, headless=h)))
