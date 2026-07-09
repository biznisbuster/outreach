"""Website enrichment — screenshot + email/phone scrape + Google fallback.

Stages per business:
  1. Screenshot of homepage (Playwright)
  2. Email + phone extraction (Playwright, follows a couple of links)
  3. (If email not found AND address is set) Google search for business name
     in the city, look at top 10 results, find a domain that looks like the
     business, and pull the contact info from it.

The original v2 only fetched one email. This adds:
  - Screenshot proof
  - Multiple emails + phone numbers
  - Robust email finding: a small linked-page crawl (Contact, Impressum,
    About) before falling back to Google.
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import urllib.parse
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import httpx
from playwright.async_api import Page

LOG = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)

# ───── Regex / patterns ─────

# Same as email.py but inlined here so we don't import circularly.
EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b")

PHONE_RE = re.compile(
    r"(?<![\d])("
    r"\+?\d{1,3}[\s\-]?\(?\d{1,4}\)?[\s\-]?\d{2,4}[\s\-]?\d{2,4}[\s\-]?\d{0,4}"
    r"|0\d{2,3}[\s\-]?\d{3}[\s\-]?\d{3,4}"
    r")(?![\d])"
)
# Strip obvious non-phone junk (date fragments, prices, ID numbers)
PHONE_BLACKLIST = re.compile(r"^(19|20)\d\d|^\d{1,2}\.\d{1,2}\.\d")

# Discord/CDN image names. Skip if matches.
SKIP_PATH_RE = re.compile(r"\.(png|jpe?g|gif|svg|webp|ico)(\?|$)", re.I)

# Obfuscation cleanup before matching emails.
OBFUSCATION = (
    (re.compile(r"\s*\[\s*at\s*\]\s*", re.I), "@"),
    (re.compile(r"\s*\(\s*at\s*\)\s*", re.I), "@"),
    (re.compile(r"\s+at\s+", re.I), "@"),
    (re.compile(r"\s*\[\s*dot\s*\]\s*", re.I), "."),
    (re.compile(r"\s*\(\s*dot\s*\)\s*", re.I), "."),
    (re.compile(r"\s+dot\s+", re.I), "."),
    (re.compile(r"&#64;", re.I), "@"),
    (re.compile(r"&#46;", re.I), "."),
    (re.compile(r"\s+@\s+"), "@"),
    (re.compile(r"\(\s*([a-z])\s*\)\s*at\s*\(\s*([a-z])\s*\)", re.I), r"\1@\2"),
)

CONTACT_PATH_HINTS = (
    "contact", "kontakt", "impressum", "about", "o nama", "team",
    "support", "help", "info", "legal", "reach",
)


def _normalize_email_text(s: str) -> str:
    for pat, rep in OBFUSCATION:
        s = pat.sub(rep, s)
    return s


def find_emails(text: str) -> list[str]:
    cleaned = _normalize_email_text(text)
    seen: set[str] = set()
    out: list[str] = []
    for m in EMAIL_RE.finditer(cleaned):
        addr = m.group(0).lower().strip(".")
        if addr in seen:
            continue
        # Heuristic filter: real emails have a 2+ letter TLD
        if "@" not in addr or "." not in addr.split("@")[1]:
            continue
        if any(b in addr for b in ("example.", "yourname", "email@", "@2x", "png@")):
            continue
        seen.add(addr)
        out.append(addr)
    return out


def find_phones(text: str) -> list[str]:
    cleaned = _normalize_email_text(text)
    out: list[str] = []
    seen: set[str] = set()
    for m in PHONE_RE.finditer(cleaned):
        phone = m.group(1).strip()
        digits = re.sub(r"\D", "", phone)
        if len(digits) < 8 or len(digits) > 15:
            continue
        if PHONE_BLACKLIST.match(digits):
            continue
        normalized = re.sub(r"\s+", " ", phone)
        if normalized in seen:
            continue
        seen.add(normalized)
        out.append(normalized)
    return out


# ───── Screenshot ─────

async def capture_homepage_screenshot(
    page: Page,
    url: str,
    out_path: Path,
    *,
    timeout_ms: int = 8000,
) -> bool:
    """Visit homepage and save a 1280x800 screenshot. Returns False on any error."""
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # Block trackers so the page doesn't hang
        await page.wait_for_timeout(500)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        await page.screenshot(path=str(out_path), full_page=False)
        return True
    except Exception as exc:  # noqa: BLE001
        LOG.debug("screenshot failed for %s: %s", url, exc)
        return False


# ───── Contact page enrichment ─────

async def _scrape_emails_and_phones_from_page(
    page: Page,
    url: str,
    *,
    timeout_ms: int = 10_000,
) -> tuple[list[str], list[str]]:
    """Visit URL, parse visible text + mailto links, return emails / phones."""
    emails: list[str] = []
    phones: list[str] = []
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        await page.wait_for_timeout(400)

        # mailto: links are gold
        try:
            anchors = await page.query_selector_all("a[href^='mailto:']")
            for a in anchors:
                href = await a.get_attribute("href")
                if href:
                    m = re.match(r"mailto:\s*([^?\s]+)", href, re.I)
                    if m:
                        emails.append(m.group(1).strip().lower())
        except Exception:  # noqa: BLE001
            pass

        body_html = await page.content()
        # Izbaci script/style sadrzaj pre regex-a (izbegavamo lazne email adrese
        # iz JS source-ova i data: URI fragmenata)
        body_html = re.sub(r"<script\b[^>]*>.*?</script>", " ", body_html, flags=re.I | re.S)
        body_html = re.sub(r"<style\b[^>]*>.*?</style>", " ", body_html, flags=re.I | re.S)
        body_html = re.sub(r"data:[^\"'\s]+", " ", body_html)
        text = re.sub(r"<[^>]+>", " ", body_html)
        text = re.sub(r"\s+", " ", text)

        # Filtriraj poznate lazne (JS src-ovi, placeholder-i, CDN)
        BLACKLIST = re.compile(
            r"scrollintoview|wixpress|example\.com|sentry|webpack|/widget|/cdn/|noreply|no-reply|test@|yoursite",
            re.I,
        )
        found_emails = [e for e in find_emails(text) if not BLACKLIST.search(e)]
        emails.extend(found_emails)
        phones.extend(find_phones(text))
    except Exception as exc:  # noqa: BLE001
        LOG.debug("contact scrape failed for %s: %s", url, exc)
    # de-dupe + stable order
    seen_e = set(); uniq_e = []
    for e in emails:
        if e not in seen_e:
            seen_e.add(e); uniq_e.append(e)
    seen_p = set(); uniq_p = []
    for p in phones:
        if p not in seen_p:
            seen_p.add(p); uniq_p.append(p)
    return uniq_e[:8], uniq_p[:8]


async def enrich_from_website(
    page: Page,
    website: str,
    *,
    screenshot_dir: Path,
    slug: str,
    base_url_hint: str | None = None,
) -> dict[str, Any]:
    """Run homepage screenshot + email/phone crawl.

    Returns dict with:
        screenshot_path (Path | None)
        extra_emails (list[str])
        extra_phones (list[str])
        primary_email (str | None) -- first email of the page or subpages
    """
    out: dict[str, Any] = {
        "screenshot_path": None,
        "extra_emails": [],
        "extra_phones": [],
        "primary_email": None,
    }

    # 1. Screenshot
    shot_path = screenshot_dir / f"{slug}.png"
    if await capture_homepage_screenshot(page, website, shot_path):
        out["screenshot_path"] = str(shot_path)

    # 2. Homepage emails + phones
    extra_e, extra_p = await _scrape_emails_and_phones_from_page(page, website)
    out["extra_emails"] = extra_e
    out["extra_phones"] = extra_p

    # Pick a primary email if any (lowest-priority is the @website domain)
    if extra_e:
        # Prefer ones matching the website domain
        host = urllib.parse.urlparse(website).hostname or ""
        bare = host.replace("www.", "")
        for e in extra_e:
            if bare and bare in e:
                out["primary_email"] = e
                break
        if not out["primary_email"]:
            out["primary_email"] = extra_e[0]

    # 3. Try contact/kontakt/impressum pages (1 hop)
    found_more_e: list[str] = []
    found_more_p: list[str] = []
    try:
        parsed = urllib.parse.urlparse(website)
        base = f"{parsed.scheme}://{parsed.hostname}"
        candidates: list[str] = []

        # (a) Pronađi anchor linkove na stranici
        try:
            anchors = await page.query_selector_all("a[href]")
            for a in anchors:
                href = await a.get_attribute("href")
                if not href:
                    continue
                href_l = href.lower()
                if any(h in href_l for h in CONTACT_PATH_HINTS):
                    if href.startswith("http"):
                        candidates.append(href)
                    elif href.startswith("/"):
                        candidates.append(base + href)
        except Exception:
            pass

        # (b) Fallback: pokušaj common putanje (ako ih već nema u (a))
        for suffix in ("/kontakt", "/contact", "/kontaktirajte-nas", "/o-nama", "/about", "/impressum"):
            full = base + suffix
            if full not in candidates:
                candidates.append(full)

        # Dedup + cap
        seen_c: set[str] = set()
        candidates = [c for c in candidates if not (c in seen_c or seen_c.add(c))][:4]
        for url in candidates:
            try:
                ee, pp = await _scrape_emails_and_phones_from_page(page, url)
                for x in ee:
                    if x not in out["extra_emails"] and x not in found_more_e:
                        found_more_e.append(x)
                for x in pp:
                    if x not in out["extra_phones"] and x not in found_more_p:
                        found_more_p.append(x)
                # Ako našli email, stani
                if out["primary_email"] is None and found_more_e:
                    out["primary_email"] = found_more_e[0]
            except Exception:
                continue
    except Exception:
        pass

    out["extra_emails"].extend(found_more_e)
    out["extra_phones"].extend(found_more_p)
    return out


# ───── Google search fallback ─────

async def google_fallback_for_website(
    page: Page,
    business_name: str,
    city: str | None,
    *,
    timeout_ms: int = 15_000,
) -> dict[str, Any] | None:
    """If the Maps business has no website, search Google for "<name> <city>".

    Returns dict with: website (str | None), top_results (list[{title, url, snippet}]).
    Caller decides whether to follow up with enrichment.
    """
    q = business_name if not city else f"{business_name} {city}"
    q = q.strip()
    if not q:
        return None
    url = f"https://www.google.com/search?q={urllib.parse.quote_plus(q)}&hl=sr"
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout_ms)
        # Dismiss consent if any
        try:
            btn = await page.query_selector("button:has-text('Прихватам'), button:has-text('I agree'), button:has-text('Prihvatam sve')")
            if btn: await btn.click(timeout=1500)
        except Exception:
            pass
        await page.wait_for_timeout(500)
        body = await page.content()
    except Exception as exc:
        LOG.debug("google fallback failed: %s", exc)
        return None

    # Capture top 10 result titles + URLs + snippets
    results = []
    # Google organic results live inside <div class="..."> wrappers — just regex URLs.
    anchors = await page.query_selector_all("a[href^='http']")
    seen = set()
    for a in anchors:
        try:
            href = await a.get_attribute("href") or ""
            txt = (await a.inner_text() or "").strip()
        except Exception:
            continue
        if not href or href in seen:
            continue
        # Skip Google's own properties
        bad = ("google.", "youtube.", "schema.org", "accounts.google")
        if any(b in href for b in bad):
            continue
        # Skip redirect wrapper URLs (google.com/url?q=...)
        if "google.com/url?" in href:
            continue
        seen.add(href)
        results.append({"title": txt[:80], "url": href})
        if len(results) >= 10:
            break
    return {"website": None, "top_results": results, "query": q}


def pick_best_website(results: Iterable[dict[str, Any]], business_name: str) -> str | None:
    """Heuristic to choose the most likely business website from Google results.

    Strategy:
      - Filter out obvious non-business domains (facebook, instagram, twitter, ...)
      - Prefer shorter/cleaner hostnames
      - Prefer domains where the title contains words from business_name
    """
    skip_domains = (
        "facebook.com", "instagram.com", "twitter.com", "x.com",
        "youtube.com", "linkedin.com", "wikipedia.org", "tiktok.com",
        "google.com", "apple.com", "play.google.com", "m.facebook.com",
    )
    name_tokens = [t.lower() for t in re.split(r"\W+", business_name) if len(t) > 2]

    scored = []
    for r in results:
        host = urllib.parse.urlparse(r["url"]).hostname or ""
        if not host or any(s in host for s in skip_domains):
            continue
        # Strip www.
        bare = host.replace("www.", "")
        # Score: title contains a name token? Subdomains? www-stripped already.
        title = (r.get("title") or "").lower()
        score = 0
        for t in name_tokens:
            if t in bare or t in title:
                score += 2
        # Bonus for short hostnames (looks more "branded")
        bare_no_tld = bare.split(".")[0]
        if len(bare_no_tld) <= 14 and bare_no_tld == name_tokens[0] if name_tokens else False:
            score += 3
        scored.append((score, r["url"]))
    if not scored:
        return None
    scored.sort(key=lambda x: -x[0])
    return scored[0][1]
