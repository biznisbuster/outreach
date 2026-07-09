"""Diagnostic: open a Maps place URL and dump the relevant DOM nodes.

Useful for fixing selectors when extraction regresses. Run::

    uv run python scripts/diag_place.py "<place url>"
"""

from __future__ import annotations

import asyncio
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from playwright.async_api import async_playwright

from maps_cold_calling.scraper.browser import browser_session


DIAG_JS = r"""() => {
    const out = { url: location.href, title: document.title };
    const panel = document.querySelector('[role="main"]');

    // All buttons with data-item-id and their labels.
    const dataButtons = panel
        ? Array.from(panel.querySelectorAll('button[data-item-id], a[data-item-id]'))
        : Array.from(document.querySelectorAll('button[data-item-id], a[data-item-id]'));
    out.dataItemIdElems = dataButtons.map((el) => ({
        tag: el.tagName.toLowerCase(),
        dataItemId: el.getAttribute('data-item-id'),
        ariaLabel: el.getAttribute('aria-label'),
        text: (el.innerText || '').trim().slice(0, 100),
        href: el.getAttribute('href'),
    }));

    // Anything with aria-label containing star/utisak/review.
    const ariaStar = Array.from(document.querySelectorAll('[aria-label]')).filter((el) => {
        const a = (el.getAttribute('aria-label') || '').toLowerCase();
        return a.includes('star') || a.includes('utisak') || a.includes('recenzij')
            || a.includes('звезд') || a.includes('рецензи');
    });
    out.ariaFiltered = ariaStar.slice(0, 25).map((el) => ({
        tag: el.tagName.toLowerCase(),
        cls: el.className,
        ariaLabel: el.getAttribute('aria-label'),
        text: (el.innerText || '').trim().slice(0, 80),
    }));

    // The H1
    const h1 = document.querySelector('h1');
    out.h1 = h1 ? (h1.innerText || '').trim() : null;

    // All anchors in panel that look like websites
    const anchors = panel ? Array.from(panel.querySelectorAll('a[href]')) : [];
    out.anchors = anchors.slice(0, 30).map((a) => ({
        href: (a.getAttribute('href') || '').slice(0, 80),
        ariaLabel: a.getAttribute('aria-label'),
        text: (a.innerText || '').trim().slice(0, 80),
    }));

    return out;
}"""


async def main(url: str) -> int:
    async with browser_session(stealth_tier="lite", headless=True, language="sr", country="RS") as (_b, ctx, _s):
        page = await ctx.new_page()
        await page.goto(url, wait_until="domcontentloaded", timeout=30_000)
        # Give Maps a beat to render.
        await page.wait_for_selector("[role='main']", timeout=20_000)
        await page.wait_for_load_state("domcontentloaded")
        await asyncio.sleep(2.0)
        result = await page.evaluate(DIAG_JS)
    print(json.dumps(result, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: diag_place.py <maps place url>", file=sys.stderr)
        sys.exit(2)
    raise SystemExit(asyncio.run(main(sys.argv[1])))
