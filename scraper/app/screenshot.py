"""Playwright headless screenshot — full-page, generous waits, robust to slow WP/blog sites.

Ključne osobine (v2):
- Pametan podrazumevani izlazni direktorijum:
    1) koristi env `SCREENSHOTS_DIR`
    2) ako env DATABASE_PATH postoji, screenshot ide u isti data root + /screenshots
    3) fallback: <project_root>/data/screenshots (relativno od ovog fajla)
- Duplo duže čekanje: 5s za inicijalni JS, 3s posle popup-close, 4s za resurse
- `wait_until="networkidle"` u drugom pokušaju (kad sačekamo više)
- Force full-page (ne viewport) — ceo sadržaj uključujući lazy-load ispod folde
- Pametnije popup/cookie zatvaranje (radi I sa i bez ad-blocking)
- Heuristika: ako stranica nema <main>/glavni sadržaj, tretira kao loading i čeka ponovo
"""
import os
import re
import time
import pathlib
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

# Domeni koje blokiramo (analytics, oglasne mreže, casino).
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
    # Casino / sumnjivi
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
    'button:has-text("Prihvati")',
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
    'button:as-text("Accept all")',
]


# ---------------------------------------------------------------------------
# Output directory resolution
# ---------------------------------------------------------------------------

def _default_screenshots_dir() -> str:
    """Odredi gde da čuvamo screenshot-ove.

    Priority:
        1) env `SCREENSHOTS_DIR` (apsolutna putanja)
        2) ako env `DATABASE_PATH` postoji → <dir of DATABASE_PATH>/screenshots
        3) fallback: <repo_root>/data/screenshots (data je sibling od scraper/app/)
    """
    explicit = os.environ.get("SCREENSHOTS_DIR")
    if explicit and explicit not in ("", "/data/screenshots", "/data"):
        return explicit

    db_path = os.environ.get("DATABASE_PATH")
    if db_path:
        d = os.path.dirname(db_path)
        return os.path.join(d, "screenshots")

    # Fallback: data/screenshots pored scraper/ foldera
    here = pathlib.Path(__file__).resolve()           # .../scraper/app/screenshot.py
    project_root = here.parent.parent.parent           # .../gui
    return str(project_root / "data" / "screenshots")


# ---------------------------------------------------------------------------
# Popup/cookie close helper
# ---------------------------------------------------------------------------

def _try_close_popups(page) -> int:
    """Pokušaj da zatvoriš popup/cookie bannere. Vraća broj zatvorenih."""
    closed = 0
    try:
        page.keyboard.press("Escape")
    except Exception:
        pass
    for sel in CLOSE_SELECTORS:
        try:
            btn = page.locator(sel).first
            if btn.count() > 0 and btn.is_visible(timeout=300):
                btn.click(timeout=500, force=True)
                closed += 1
        except Exception:
            pass
    return closed


# ---------------------------------------------------------------------------
# Main capture function
# ---------------------------------------------------------------------------

def capture_screenshot(
    url: str,
    lead_id: int,
    out_dir: str | None = None,
    *,
    min_content_chars: int = 300,
    max_attempts: int = 2,
    pre_wait_ms: int = 5000,
) -> str | None:
    """Snima FULL-PAGE screenshot. Vraća apsolutnu putanju ili None.

    Args:
        url: URL stranice za screenshot.
        lead_id: lead id (koristi se samo u imenu fajla).
        out_dir: gde sačuvati (default — vidi `_default_screenshots_dir`).
        min_content_chars: minimalan broj karaktera u body.innerText pre slikanja.
            Ako je manje, čeka još i ponovo pokušava.
        max_attempts: koliko puta pokušati za isti URL.
        pre_wait_ms: koliko dugo čekati posle `domcontentloaded` pre screenshot-a
            (dobija vreme za lazy-load slika, fontove, popup-ove).
    """
    out_dir = out_dir or _default_screenshots_dir()
    try:
        os.makedirs(out_dir, exist_ok=True)
    except PermissionError as e:
        print(f"[screenshot] cannot create {out_dir}: {e}")
        return None

    timestamp_ms = int(time.time() * 1000)
    out_path = os.path.join(out_dir, f"{lead_id}_{timestamp_ms}.png")

    def block_ads(route):
        u = route.request.url
        if any(dom in u for dom in BLOCKED_DOMAINS):
            return route.abort()
        return route.continue_()

    last_err = None
    for attempt_no in range(1, max_attempts + 1):
        use_blocking = (attempt_no == 1)  # prvi pokušaj sa blocking-om
        for retry_no in ([1, 2] if use_blocking else [1]):
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

                    # Faza 1: učitaj HTML. Prvi pokušaj čeka samo DOM;
                    # retry čeka networkidle (sporiji ali siguran za JS sajtove)
                    wait_strategy = "domcontentloaded" if retry_no == 1 else "networkidle"
                    page.goto(url, wait_until=wait_strategy, timeout=45000)

                    # Faza 2: korisnički-definisan pre-wait (5s po defaultu)
                    page.wait_for_timeout(pre_wait_ms)

                    # Faza 3: zatvori popup / cookie bannere
                    closed = _try_close_popups(page)
                    if closed:
                        page.wait_for_timeout(2500)

                    # Faza 4: ako telo još nema dovoljno teksta → čeka još
                    try:
                        page.wait_for_function(
                            f"document.body && document.body.innerText.length >= {min_content_chars}",
                            timeout=8000,
                        )
                    except PWTimeout:
                        # Stranica možda nikad ne dostigne threshold (image-only).
                        # U tom slučaju slikaj ono što ima — bolje nego ništa.
                        pass

                    # Faza 5: dodatno čekanje za slike/iframe-ove/fontove
                    page.wait_for_timeout(3500)

                    # Faza 6: lazy-scroll do dna pa nazad
                    try:
                        page.evaluate(
                            """
                            async () => {
                                const total = document.body.scrollHeight;
                                const step = window.innerHeight;
                                for (let y = 0; y <= total; y += step) {
                                    window.scrollTo(0, y);
                                    await new Promise((r) => setTimeout(r, 250));
                                }
                                window.scrollTo(0, 0);
                            }
                            """
                        )
                        # Sačekaj da se posle scroll-a slike dodaju u DOM
                        page.wait_for_timeout(2500)
                    except Exception:
                        pass

                    # Faza 7: ako je ostao vidljiv overlay, probaj ESC + još close
                    has_overlay = page.evaluate(
                        """
                        () => {
                            const els = document.querySelectorAll('[role="dialog"], [class*="modal" i], [class*="overlay" i], [class*="popup" i]');
                            for (const el of els) {
                                const cs = getComputedStyle(el);
                                if (cs.display !== 'none' && cs.visibility !== 'hidden' && el.offsetWidth > 200 && cs.position === 'fixed') {
                                    return true;
                                }
                            }
                            return false;
                        }
                        """
                    )
                    if has_overlay:
                        _try_close_popups(page)
                        page.wait_for_timeout(1500)

                    # Faza 8: SNIMI — full_page=True (čitava visina, ne samo viewport)
                    page.screenshot(
                        path=out_path,
                        full_page=True,
                        animations="disabled",
                    )
                    browser.close()

                    if os.path.exists(out_path) and os.path.getsize(out_path) > 1024:
                        print(
                            f"[screenshot] OK (attempt={attempt_no}, blocking={use_blocking}, retry={retry_no}) "
                            f"{url} → {out_path} ({os.path.getsize(out_path)} B)"
                        )
                        return out_path
                    else:
                        last_err = f"output file too small or missing ({os.path.getsize(out_path) if os.path.exists(out_path) else 0} B)"
                        try:
                            os.remove(out_path)
                        except OSError:
                            pass
            except Exception as e:
                err_msg = str(e)[:200]
                last_err = f"{type(e).__name__}: {err_msg}"
                print(
                    f"[screenshot] attempt {attempt_no} blocking={use_blocking} retry={retry_no} "
                    f"za {url} fail: {last_err}"
                )
                if use_blocking and retry_no == 1:
                    # Ako je blocking pravio problem, probaj bez njega
                    continue
                if not use_blocking:
                    break

    print(f"[screenshot] FAILED for {url} (last err: {last_err})")
    return None
