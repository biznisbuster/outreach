"""Tech-stack detection: server, framework, JS framework, CSS framework, hosting.

Pure detection — does not score by itself (tech/modernness category scoring
lives in ``aggregate.py``). Returns a dict so the caller can decide.
"""
from __future__ import annotations

import re


# Common CMS / framework signals
_GENERATOR_RE = re.compile(r'<meta\b[^>]*name=["\']generator["\'][^>]*content=["\']([^"\']+)["\']', re.IGNORECASE)

# URL path patterns (from <link href=...> and <script src=...>)
_HTML_PATTERNS = {
    "wordpress": re.compile(r"/wp-content/|/wp-includes/|/wp-json/|wp-login|wp-content/themes/", re.IGNORECASE),
    "drupal": re.compile(r"/sites/default/files/|/sites/all/modules/|Drupal\.settings", re.IGNORECASE),
    "joomla": re.compile(r"/templates/|com_content|option=com_", re.IGNORECASE),
    "shopify": re.compile(r"/cdn/shop|Shopify\.theme", re.IGNORECASE),
    "magento": re.compile(r"/static/version|Magento_", re.IGNORECASE),
    "wix": re.compile(r"wixstatic\.com|wix\.com/_partials", re.IGNORECASE),
    "squarespace": re.compile(r"squarespace\.com|sqsp", re.IGNORECASE),
    "nextjs": re.compile(r"/_next/|__NEXT_DATA__|next/static", re.IGNORECASE),
    "nuxt": re.compile(r"/_nuxt/|__NUXT__", re.IGNORECASE),
    "gatsby": re.compile(r"/page-data/|gatsby-", re.IGNORECASE),
    "react": re.compile(r"data-react|data-reactroot|data-react-helmet", re.IGNORECASE),
    "vue": re.compile(r"data-v-[a-z0-9]{8,}|__nuxt__|v-cloak|v-if|v-for", re.IGNORECASE),
    "angular": re.compile(r"\bng-[a-z\-]+=|\bng-app\b|angular\.module", re.IGNORECASE),
    "svelte": re.compile(r"svelte-[a-z0-9]{8,}|class=\"svelte-", re.IGNORECASE),
    "bootstrap": re.compile(r"\bbtn-primary\b|\bcontainer-fluid\b|bootstrap\.min\.css", re.IGNORECASE),
    "tailwind": re.compile(r"tailwindcss|tailwind\.min\.css|tailwindcss\.com"),
}

_HOSTING_HEADER_PATTERNS = {
    "cloudflare": re.compile(r"cloudflare|cf-ray", re.IGNORECASE),
    "vercel": re.compile(r"vercel|x-vercel-id", re.IGNORECASE),
    "netlify": re.compile(r"netlify|x-nf-request-id", re.IGNORECASE),
    "aws_cloudfront": re.compile(r"cloudfront|aws|x-amz-", re.IGNORECASE),
    "akamai": re.compile(r"akamai", re.IGNORECASE),
    "fastly": re.compile(r"fastly|x-served-by", re.IGNORECASE),
    "google_cloud": re.compile(r"google\s?app\s?engine|gae|gcp|google frontend|ghs", re.IGNORECASE),
    "azure": re.compile(r"azure|microsoft-azure", re.IGNORECASE),
}

_HTML_HOSTING_PATTERNS = {
    "heroku": re.compile(r"\.herokuapp\.com|heroku", re.IGNORECASE),
    "github_pages": re.compile(r"\.github\.io", re.IGNORECASE),
}


def detect_tech_stack(pages: list[dict], homepage_headers: dict | None = None) -> dict:
    """Returns a dict with detected platforms / frameworks / hosting.

    Caller passes `pages` (each carrying ``url`` and ``html``) and ideally the
    homepage response headers for server-side hints.
    """
    all_html = "\n".join((p.get("html") or "") for p in pages)
    headers_lc = {k.lower(): v for k, v in (homepage_headers or {}).items()}

    generators = set()
    for m in _GENERATOR_RE.finditer(all_html):
        generators.add(m.group(1).strip())

    cms = _detect_from(all_html, _HTML_PATTERNS)
    html_hosting = _detect_from(all_html, _HTML_HOSTING_PATTERNS)
    header_hosting = _detect_from_headers(headers_lc)

    server = headers_lc.get("server")
    x_powered = headers_lc.get("x-powered-by")

    js_framework = next((k for k in ("react", "vue", "angular", "svelte", "nextjs", "nuxt", "gatsby") if cms.get(k)), None)
    css_framework = "tailwind" if cms.get("tailwind") else ("bootstrap" if cms.get("bootstrap") else None)
    cms_name = next((k for k in ("wordpress", "drupal", "joomla", "shopify", "magento", "wix", "squarespace") if cms.get(k)), None)

    # Hosting: prefer header signal, fall back to HTML
    hosting = header_hosting or html_hosting

    return {
        "cms": cms_name,
        "cms_signals": [k for k, v in cms.items() if v and k in ("wordpress", "drupal", "joomla", "shopify", "magento", "wix", "squarespace")],
        "js_framework": js_framework,
        "css_framework": css_framework,
        "hosting": list(hosting),
        "server_header": server,
        "x_powered_by": x_powered,
        "meta_generators": sorted(generators),
    }


def _detect_from(text: str, patterns: dict) -> dict:
    return {k: bool(re.search(p, text)) for k, p in patterns.items()}


def _detect_from_headers(headers: dict) -> set:
    found = set()
    blob = " ".join(f"{k}: {v}" for k, v in headers.items())
    for name, pat in _HOSTING_HEADER_PATTERNS.items():
        if pat.search(blob):
            found.add(name)
    return found


# ---------------------------------------------------------------------------
# Tech / modernness scoring (used by aggregate.py)
# ---------------------------------------------------------------------------

def tech_modernness_score(detected: dict, *, http2: bool) -> int:
    """0-100 score derived from tech-stack + http2 + structured data presence.

    We don't penalise older stacks — we reward modern signals.
    """
    score = 0

    # Modern SSG / framework
    framework = (detected.get("js_framework") or "").lower()
    if framework in ("nextjs", "nuxt", "gatsby"):
        score += 25
    elif framework in ("react", "vue", "angular", "svelte"):
        score += 15
    # Modern hosting
    hosting = [h.lower() for h in detected.get("hosting") or []]
    if "vercel" in hosting or "netlify" in hosting or "google_cloud" in hosting:
        score += 25
    elif "aws_cloudfront" in hosting or "cloudflare" in hosting:
        score += 15
    elif "azure" in hosting or "akamai" in hosting or "fastly" in hosting:
        score += 10
    # HTTP/2
    if http2:
        score += 25
    # No x-powered-by leaking internals → tiny bonus
    if not detected.get("x_powered_by"):
        score += 10
    # CSP / security infrastructure invisible here — counted in security.py
    # But absence of generator meta is a quality signal — minor bonus
    if not detected.get("meta_generators"):
        score += 15
    return min(100, score)
