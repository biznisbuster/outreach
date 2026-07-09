"""Scrape pojedinačne stranice: httpx fetch + trafilatura (tekst) + extruct (struktuirani podaci) + lxml (meta).
Izračunava SEO metrike po stranici.
"""
import re
import time
import httpx
from urllib.parse import urlparse

import trafilatura
import extruct
from lxml import html as lxml_html

from .categorize import categorize_page
from .seo_metrics import compute_seo_metrics

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
FALLBACK_UA = "Mozilla/5.0"

BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,sr;q=0.8",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}


def scrape_page(url: str, timeout: float = 20.0) -> dict | None:
    """Vraća dict sa: url, title, meta_description, h1, word_count, reading_time,
    body_summary, seo_metrics, category, status_code. None ako fetch padne."""
    t0 = time.time()
    r = None
    html_text = None
    content_type = ""
    for headers in (BROWSER_HEADERS, {**BROWSER_HEADERS, "User-Agent": FALLBACK_UA}):
        try:
            with httpx.Client(headers=headers, follow_redirects=True, timeout=timeout) as c:
                r = c.get(url)
                if r.status_code == 403:
                    continue
                break
        except Exception:
            continue
    if r is None:
        return None

    if r.status_code >= 400:
        return {"url": url, "status_code": r.status_code, "category": "Other", "word_count": 0, "reading_time": 0, "seo_metrics": {}}

    html_text = r.text
    content_type = r.headers.get("content-type", "")
    if "html" not in content_type and not html_text.strip().lower().startswith("<!doctype") and not html_text.strip().startswith("<html"):
        return None

    # Parsiranje sa lxml-om
    try:
        tree = lxml_html.fromstring(html_text)
    except Exception:
        return None

    # osnovni elementi
    title = _text(tree.xpath("//title/text()"))
    meta_desc = _attr(tree.xpath('//meta[@name="description"]/@content'))
    h1_list = [t.strip() for t in tree.xpath("//h1//text()") if t.strip()]
    h1 = h1_list[0] if h1_list else None

    # tekstualni sadržaj sa trafilaturom
    body_text = ""
    body_summary = ""
    try:
        body_text = trafilatura.extract(html_text, include_comments=False, include_tables=False) or ""
        body_summary = (body_text[:500] + "…") if len(body_text) > 500 else body_text
    except Exception:
        pass

    word_count = len(body_text.split()) if body_text else 0
    reading_time = max(1, round(word_count / 200))  # ~200 reči/min

    # struktuirani podaci (JSON-LD, microdata, opengraph)
    structured = {}
    try:
        data = extruct.extract(html_text, base_url=url, uniform=True, errors="ignore")
        structured = {k: v for k, v in data.items() if v}
    except Exception:
        pass

    # slike
    img_total = len(tree.xpath("//img"))
    img_with_alt = len(tree.xpath("//img[@alt and string-length(@alt)>0]"))
    internal_links = len(tree.xpath(f"//a[contains(@href,'{urlparse(url).netloc}')]"))
    external_links = len(tree.xpath("//a")) - internal_links

    seo_metrics = compute_seo_metrics(
        title=title,
        meta_desc=meta_desc,
        h1=h1,
        word_count=word_count,
        img_total=img_total,
        img_with_alt=img_with_alt,
        internal_links=internal_links,
        external_links=external_links,
        structured=structured,
    )

    category = categorize_page(url, title, h1)

    return {
        "url": url,
        "title": title,
        "meta_description": meta_desc,
        "h1": h1,
        "word_count": word_count,
        "reading_time": reading_time,
        "body_summary": body_summary,
        "category": category,
        "status_code": r.status_code,
        "seo_metrics": seo_metrics,
        "fetch_ms": round((time.time() - t0) * 1000),
    }


def _text(nodes) -> str | None:
    for n in nodes:
        s = (n or "").strip()
        if s:
            return s
    return None


def _attr(nodes) -> str | None:
    for n in nodes:
        s = (n or "").strip()
        if s:
            return s
    return None
