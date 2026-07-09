"""Playwright boot smoke — opens Google Maps search results and asserts a sane title.

Run with:  uv run python scripts/smoke_browser.py

Exits 0 on success, 1 on failure. Useful as a sanity check on a fresh machine
or after a `uv run playwright install chromium`.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

# allow running from project root without installing the package
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from playwright.async_api import async_playwright


async def smoke() -> int:
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        context = await browser.new_context(
            locale="sr-RS",
            timezone_id="Europe/Belgrade",
            viewport={"width": 1280, "height": 800},
            user_agent=(
                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
        )
        page = await context.new_page()
        try:
            await page.goto(
                "https://www.google.com/maps/search/frizerski+salon+Krusevac/?hl=sr&gl=rs",
                wait_until="domcontentloaded",
                timeout=30_000,
            )
            title = await page.title()
            print(f"[smoke] title: {title!r}")
            # Accept any of the common "Google Maps" localizations:
            # "Maps" (en), "Mappe" (de/it), "Maps" (fr/...),
            # "Мапе" (sr), "Карти" (uk), "Mapy" (pl), "Maps" (es), "Həritələr" nope
            # etc. We accept any title starting with "Google".
            if not title.lower().startswith("google"):
                print("[smoke] FAIL: title does not start with 'Google'", file=sys.stderr)
                return 1
            # And explicitly cross-check that page URL is on Maps:
            assert "/maps" in page.url, f"unexpected URL: {page.url}"
            print("[smoke] OK")
            return 0
        except Exception as exc:  # broad catch — this is a smoke test
            print(f"[smoke] FAIL: {exc}", file=sys.stderr)
            return 1
        finally:
            await context.close()
            await browser.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(smoke()))
