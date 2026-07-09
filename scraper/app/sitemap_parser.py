"""Sitemap parser — čita sitemap.xml, podržava sitemap index (ugnježđene).
Fallback: ako nema sitemap-a, vraća None pa se koristi crawl sa homepage-a.
"""
import re
import httpx
from urllib.parse import urlparse

USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"

BROWSER_HEADERS = {
    "User-Agent": USER_AGENT,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9,sr;q=0.8",
    "Connection": "keep-alive",
    "Upgrade-Insecure-Requests": "1",
}

# Fallback UA za sajtove čiji WAF blokira pun Chrome UA string
FALLBACK_UA = "Mozilla/5.0"


def _fetch(url: str, timeout: float = 15.0) -> str | None:
    for headers in (BROWSER_HEADERS, {**BROWSER_HEADERS, "User-Agent": FALLBACK_UA}):
        try:
            with httpx.Client(headers=headers, follow_redirects=True, timeout=timeout) as c:
                r = c.get(url)
                ct = r.headers.get("content-type", "")
                if r.status_code == 200 and ("xml" in ct or r.text.strip().startswith("<?xml")):
                    return r.text
                if r.status_code == 403:
                    continue  # pokušaj fallback UA
                return None
        except Exception:
            continue
    return None


_URL_RE = re.compile(r"<loc>(.*?)</loc>", re.IGNORECASE | re.DOTALL)


def _extract_urls(xml_text: str) -> list[str]:
    return [m.strip() for m in _URL_RE.findall(xml_text) if m.strip()]


def find_sitemap(base_url: str) -> str | None:
    """Pokušava /sitemap.xml, /sitemap_index.xml i robots.txt."""
    parsed = urlparse(base_url)
    root = f"{parsed.scheme}://{parsed.netloc}"

    candidates = [f"{root}/sitemap.xml", f"{root}/sitemap_index.xml", f"{root}/sitemap/sitemap.xml"]
    for url in candidates:
        txt = _fetch(url)
        if txt:
            return url
    # robots.txt
    robots = _fetch(f"{root}/robots.txt")
    if robots:
        for line in robots.splitlines():
            if line.lower().startswith("sitemap:") and "http" in line:
                sitemap_url = line.split(":", 1)[1].strip()
                if _fetch(sitemap_url):
                    return sitemap_url
    return None


def parse_sitemap(sitemap_url: str, max_depth: int = 5) -> list[str]:
    """Rekurzivno parsira sitemap (index → children). Vraća listu page URL-ova."""
    visited = set()
    pages: list[str] = []

    def _rec(url: str, depth: int):
        if depth > max_depth or url in visited:
            return
        visited.add(url)
        txt = _fetch(url)
        if not txt:
            return
        urls = _extract_urls(txt)
        for u in urls:
            if u.lower().endswith(".xml") or "/sitemap" in u.lower():
                _rec(u, depth + 1)
            else:
                pages.append(u)

    _rec(sitemap_url, 0)
    return pages
