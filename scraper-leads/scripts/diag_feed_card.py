"""Debug what the JS eval returns for a search-feed card."""
import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from playwright.async_api import async_playwright

from maps_cold_calling.scraper.browser import browser_session


async def main() -> int:
    url = "https://www.google.com/maps/search/frizerski+salon+Kru%C5%A1evac/?hl=sr&gl=RS"
    async with browser_session(stealth_tier="lite", headless=True, language="sr", country="RS") as (_b, ctx, _s):
        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded")
        await asyncio.sleep(5.0)
        result = await page.evaluate("""() => {
            const anchors = document.querySelectorAll('a[href*="/maps/place/"]');
            const out = [];
            for (let i = 0; i < Math.min(3, anchors.length); i++) {
                const el = anchors[i];
                let card = el.parentElement;
                let chain = [card && card.tagName + '.' + (card.className||'').slice(0,40)];
                while (card && card.innerText.length < 80) {
                    card = card.parentElement;
                    chain.push(card ? card.tagName + '.' + (card.className||'').slice(0,40) : 'null');
                    if (chain.length > 10) break;
                }
                out.push({
                    href: el.href,
                    finalCard: card ? card.innerText.slice(0, 200) : '',
                    chain: chain.slice(0, 6)
                });
            }
            return out;
        }""")
        import json
        print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
