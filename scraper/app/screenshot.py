"""Playwright headless screenshot homepage-a.

Poboljšanja:
- Duže čekanje (5s) da se popup/cookie banner pojavi
- Auto-zatvaranje poznatih popup-ova: ESC + X dugmad + cookie consent
- Agresivnije blokiranje third-party skripti i oglasnih mreža
- Retry sa dužim timeoutom za spore sajtove
- Provera da li je body potpuno učitan
"""
import os
import re
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# Domeni koje blokiramo (analytics, oglasne mreže).
# PAŽLJIVO: ne blokirati CDN-ove (envatousercontent, cloudflare, fonts, itd.)
# jer neki sajtovi zavise od njih za osnovno učitavanje.
BLOCKED_DOMAINS = (
    # Analytics
    "google-analytics.com",
    "googletagmanager.com",
    "facebook.com",
    "facebook.net",
    "connect.facebook.net",
    "hotjar.com",
    "mixpanel.com",
    "segment.io",
    "segment.com",
    # Oglasne mreže
    "doubleclick.net",
    "adservice.google.com",
    "googlesyndication.com",
    "googleadservices.com",
    "adnxs.com",
    "pubmatic.com",
    "rubiconproject.com",
    "criteo.com",
    "criteo.net",
    "taboola.com",
    "outbrain.com",
    # Casino / sumnjivi (ovo se pojavilo na dunjincvet.com)
    "winter4d.",
    "habanero",
    "pragmaticplay",
    "evolutiongaming",
)

# Selektori za "X" dugmad na popup-ovima / cookie bannerima.
CLOSE_SELECTORS = [
    'button[aria-label*="lose" i]',
    'button[aria-label*="zatvori" i]',
    'button[aria-label*="dismiss" i]',
    'a[aria-label*="lose" i]',
    '[role="dialog"] button[aria-label*="lose" i]',
    '.modal-close',
    '.close-button',
    '.close-btn',
    '.popup-close',
    '.js-close',
    'button.close',
    'button[class*="close" i]',
    # Cookie consent — tipični "I agree" / "Prihvatam"
    'button:has-text("Prihvatam")',
    'button:has-text("Prihvaćam")',
    'button:has-text("I agree")',
    'button:has-text("Accept")',
    'button:has-text("Got it")',
    'button:has-text("OK")',
    'button:has-text("Allow")',
    'button:has-text("Dozvoli")',
    'button:has-text("Razumem")',
    'button:has-text("Slažem se")',
    'button:has-text("Allow all")',
    'button:has-text("Accept all")',
]


def _try_close_popups(page) -> int:
    """Pokušaj da zatvoriš popup/cookie bannere. Vraća broj zatvorenih."""
    closed = 0
    # 1) ESC taster (mnogi popup-ovi reaguju na ESC)
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    # 2) Klik na "X" dugmad
    for sel in CLOSE_SELECTORS:
        try:
            btn = page.locator(sel).first
            if btn.count() > 0 and btn.is_visible(timeout=300):
                btn.click(timeout=500, force=True)
                closed += 1
        except Exception:
            pass
    return closed


def capture_screenshot(url: str, lead_id: int, out_dir: str = "/data/screenshots") -> str | None:
    """Snima full-page screenshot. Vraća apsolutnu putanju fajla ili None.

    Strategija (retry logika):
    1. Pokušaj sa ad-blocking listom (brži load, manje popupa)
    2. Ako ERR_FAILED → retry BEZ blokiranja (npr. CDN-ovi zavise od blocked domena)
    3. `domcontentloaded` + 3s čekanje (da se popup pojavi)
    4. Zatvori popup/cookie bannere (ESC + X dugmad)
    5. Još 3s čekanje (da pravi sadržaj zameni popup)
    6. Provera overlay-a, ESC ako ima
    7. Slikaj
    """
    os.makedirs(out_dir, exist_ok=True)
    # Svaki scrape pravi NOVI fajl (sa timestamp-om) tako da se istorija
    # screenshot-ova čuva na disku umesto da se prepisuje.
    import time as _time
    timestamp_ms = int(_time.time() * 1000)
    out_path = os.path.join(out_dir, f"{lead_id}_{timestamp_ms}.png")

    def block_ads(route):
        url = route.request.url
        if any(dom in url for dom in BLOCKED_DOMAINS):
            return route.abort()
        return route.continue_()

    # Pokušaj 1: sa ad-blocking. Pokušaj 2: bez blokiranja (za sajtove sa CDN dependency).
    for attempt, use_blocking in enumerate([True, False], start=1):
        if use_blocking and attempt > 1:
            continue
        try:
            with sync_playwright() as p:
                browser = p.chromium.launch(
                    headless=True,
                    args=[
                        "--no-sandbox",
                        "--disable-dev-shm-usage",
                        "--disable-popup-blocking",
                        "--disable-notifications",
                        "--ignore-certificate-errors",
                    ],
                )
                context = browser.new_context(
                    viewport={"width": 1280, "height": 800},
                    device_scale_factor=1,
                    user_agent=USER_AGENT,
                    geolocation={"latitude": 44.8125, "longitude": 20.4612},
                    locale="sr-RS",
                    timezone_id="Europe/Belgrade",
                )
                page = context.new_page()
                if use_blocking:
                    page.route("**/*", block_ads)

                # Faza 1: učitaj HTML
                page.goto(url, wait_until="domcontentloaded", timeout=30000)

                # Faza 2: sačekaj 3s da se inicijalni JS izvrši i popup se pojavi
                page.wait_for_timeout(3000)

                # Faza 3: zatvori popup / cookie bannere
                if use_blocking:  # samo sa blocking-om imamo smisla zatvarati
                    closed = _try_close_popups(page)
                    if closed:
                        page.wait_for_timeout(1500)

                # Faza 4: čekaj na tekstualni sadržaj
                try:
                    page.wait_for_function(
                        "document.body && document.body.innerText.length > 100",
                        timeout=5000,
                    )
                except PWTimeout:
                    pass

                # Faza 5: dodatno čekanje za slike/iframe-ove/fontove
                page.wait_for_timeout(2500)

                # Faza 5b: scrolluj do dna da bi se svi lazy-load resursi (slike,
                # infinite-scroll, itd.) pokrenuli PRE nego što Playwright po훔e
                # da skenira stranu za full-page screenshot.
                try:
                    page.evaluate("""
                        async () => {
                            const total = document.body.scrollHeight;
                            const step = window.innerHeight;
                            for (let y = 0; y <= total; y += step) {
                                window.scrollTo(0, y);
                                await new Promise((r) => setTimeout(r, 100));
                            }
                            window.scrollTo(0, 0);
                        }
                    """)
                    page.wait_for_timeout(1500)
                except Exception:
                    # Best effort — ako lazy-scroll ne uspe, fallback na stat훋ki render
                    pass

                # Faza 6: ako je ostao vidljiv overlay, probaj ESC ponovo
                has_overlay = page.evaluate("""
                    () => {
                        const els = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="overlay" i], [class*="popup" i]');
                        for (const el of els) {
                            const cs = getComputedStyle(el);
                            if (cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetWidth > 200) {
                                return true;
                            }
                        }
                        return false;
                    }
                """)
                if has_overlay:
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(1500)

                # Snimi celu stranu (full_page=True), ne samo viewport — cela
                # visina stranice, uključujući lazy-loaded sadržaj ispod folde.
                page.screenshot(path=out_path, full_page=True, animations="disabled")
                browser.close()
                if os.path.exists(out_path) and os.path.getsize(out_path) > 0:
                    print(f"[screenshot] OK (attempt={attempt}, blocking={use_blocking}) {url} → {out_path}")
                    return out_path
        except (PWTimeout, Exception) as e:
            err_msg = str(e)[:200]
            print(f"[screenshot] attempt {attempt} ({use_blocking=}) za {url} fail: {type(e).__name__}: {err_msg}")
            if use_blocking and "ERR_FAILED" in err_msg:
                # Retry bez blokiranja
                continue
            if not use_blocking:
                # Već smo probali bez blokiranja, odustani
                break
    return None
