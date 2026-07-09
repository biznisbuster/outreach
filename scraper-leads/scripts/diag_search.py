"""Diagnose what Maps returns for a search URL when the feed is missing.

Saves the page HTML and title so we can see if it's captcha / consent / actual search.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from playwright.async_api import async_playwright

from maps_cold_calling.scraper.browser import browser_session


async def main(query: str, city: str) -> int:
    from urllib.parse import quote_plus
    url = f"https://www.google.com/maps/search/{quote_plus(f'{query} {city}')}/?hl=sr&gl=RS"
    print("URL:", url)
    out_dir = ROOT / "scripts" / "_diag"
    out_dir.mkdir(exist_ok=True)
    html_path = out_dir / "page.html"
    title_path = out_dir / "title.txt"

    async with browser_session(stealth_tier="off", headless=True, language="sr", country="RS") as (_b, ctx, _s):
        page = await ctx.new_page()
        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        except Exception as exc:
            print(f"goto failed: {exc}")
            return 1
        await asyncio.sleep(3)
        title = await page.title()
        body_text = (await page.evaluate("() => document.body.innerText")) or ""
        url_final = page.url
        html = await page.content()
        html_path.write_text(html, encoding="utf-8")
        title_path.write_text(f"{title}\n{url_final}\n\n--- BODY EXCERPT ---\n{body_text[:2000]}", encoding="utf-8")

    print("title:", title)
    print("final url:", url_final)
    print("html saved to:", html_path)
    print(f"body excerpt saved to: {title_path}")
    return 0


if __name__ == "__main__":
    q = sys.argv[1] if len(sys.argv) > 1 else "frizerski salon"
    c = sys.argv[2] if len(sys.argv) > 2 else "Kruševac"
    raise SystemExit(asyncio.run(main(q, c)))
