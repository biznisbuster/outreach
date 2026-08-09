"""On-page signals audit: contact info, social profiles, analytics, chat,
cookie banner.

Operates primarily on the homepage HTML (and a second pass on every other page
for contact / social link discovery).
"""
from __future__ import annotations

from dataclasses import dataclass
import re


@dataclass
class OnpageResult:
    raw: dict
    score: int
    issues: list[str]


# --- regexes ---

# Email: standard pattern, but limited to obvious footers / contact blocks
# so we don't pick up noreply@wordpress.com. This is a heuristic.
_EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b")
# Discard example.com, yourdomain, youremail, .png, .jpg (false positives)
_DISCARD_EMAIL_DOMAIN_RE = re.compile(
    r"\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$",
    re.IGNORECASE,
)
# Phone (international-ish).  +CC optional, then groups.
_PHONE_RE = re.compile(r"\+?\d[\d\s().\-]{7,}\d")

# Address heuristic: lines that contain a street keyword + digits.
_STREET_RE = re.compile(
    r"(?im)^(?:\s*)(?:[A-ZŠĐČĆŽ][\wŠĐČĆŽšđčćž\.\- ]{2,}\s+)?\d+[A-Za-z]?(?:[/\-]\d+)?[A-Za-z]?\s*[,;]?\s*\d{5}\s*[A-ZŠĐČĆŽ][\wŠĐČĆŽšđčćž\.\- ]{2,}"
)

# Social profile patterns
_SOCIAL = {
    "facebook": re.compile(r"https?://(?:www\.)?facebook\.com/[A-Za-z0-9._\-]+", re.IGNORECASE),
    "instagram": re.compile(r"https?://(?:www\.)?instagram\.com/[A-Za-z0-9._\-]+", re.IGNORECASE),
    "twitter": re.compile(r"https?://(?:www\.)?(?:twitter|x)\.com/[A-Za-z0-9._\-]+", re.IGNORECASE),
    "linkedin": re.compile(r"https?://(?:[a-z]+\.)?linkedin\.com/[A-Za-z0-9/_\-]+", re.IGNORECASE),
    "youtube": re.compile(r"https?://(?:www\.)?youtube\.com/(?:@?[A-Za-z0-9._\-]+|channel/|c/|user/)", re.IGNORECASE),
    "tiktok": re.compile(r"https?://(?:www\.)?tiktok\.com/@[A-Za-z0-9._\-]+", re.IGNORECASE),
    "pinterest": re.compile(r"https?://(?:www\.)?pinterest\.com/[A-Za-z0-9._\-]+", re.IGNORECASE),
}

# Analytics / marketing scripts
_ANALYTICS = {
    "google_analytics": re.compile(r"google-analytics\.com|gtag\(['\"]?['\"]?\s*,\s*['\"]?(?:config|js)|GoogleAnalytics|UA-\d{4,}-\d+|G-[A-Z0-9]{4,}", re.IGNORECASE),
    "gtm": re.compile(r"googletagmanager\.com/gtm\.js|GTM-[A-Z0-9]+", re.IGNORECASE),
    "facebook_pixel": re.compile(r"connect\.facebook\.net|fbq\(|fb-events\.js", re.IGNORECASE),
    "hotjar": re.compile(r"static\.hotjar\.com|hotjar\.com/c/hotjar-", re.IGNORECASE),
    "linkedin_insight": re.compile(r"snap\.licdn\.com|px\.adsrvr\.org|linkedin\.com/li/track", re.IGNORECASE),
    "tiktok_pixel": re.compile(r"analytics\.tiktok\.com", re.IGNORECASE),
    "matomo": re.compile(r"matomo\.js|matomo\.php", re.IGNORECASE),
}

# Chat widgets
_CHAT = {
    "intercom": re.compile(r"intercom\.io|intercom\.com|Intercom\(['\"]", re.IGNORECASE),
    "tawk": re.compile(r"tawk\.to|TAWK\(|tawk_", re.IGNORECASE),
    "crisp": re.compile(r"crisp\.chat|CRISP", re.IGNORECASE),
    "drift": re.compile(r"drift\.com|drift\.load|driftt\.com", re.IGNORECASE),
    "livechat": re.compile(r"livechatinc\.com|LC_API", re.IGNORECASE),
    "zendesk_chat": re.compile(r"zendesk\.com.*chat|zopim", re.IGNORECASE),
    "tidio": re.compile(r"tidio\.co|tidioChat", re.IGNORECASE),
}

# CDN / WAF (informational)
_CDN = {
    "cloudflare": re.compile(r"cf-ray|__cfduid|cloudflareinsights\.com"),
    "sucuri": re.compile(r"x-sucuri-id|sucuri\.net"),
    "akamai": re.compile(r"akamai|akamaiedge"),
    "fastly": re.compile(r"x-fastly|x-served-by:.*cache-.*fastly"),
}

_COOKIE_TEXT_RE = re.compile(
    r"(?i)(prihvatam|slažem se|prihvati|cookie|kolačić|kukič|kolačića|consent|slažemo se|saglasnost|we use cookies)"
)


# Open Graph meta tags (Facebook, LinkedIn, Discord…) — važno za share preview-e
_OG_TITLE_RE = re.compile(r'<meta\b[^>]*\bproperty=["\']og:title["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_OG_DESCRIPTION_RE = re.compile(r'<meta\b[^>]*\bproperty=["\']og:description["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_OG_IMAGE_RE = re.compile(r'<meta\b[^>]*\bproperty=["\']og:image["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_OG_TYPE_RE = re.compile(r'<meta\b[^>]*\bproperty=["\']og:type["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_OG_URL_RE = re.compile(r'<meta\b[^>]*\bproperty=["\']og:url["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)

# Twitter Card tags (X/Twitter)
_TW_CARD_RE = re.compile(r'<meta\b[^>]*\bname=["\']twitter:card["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_TW_TITLE_RE = re.compile(r'<meta\b[^>]*\bname=["\']twitter:title["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_TW_DESCRIPTION_RE = re.compile(r'<meta\b[^>]*\bname=["\']twitter:description["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)
_TW_IMAGE_RE = re.compile(r'<meta\b[^>]*\bname=["\']twitter:image["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)

# Hreflang — multilingual / region-specific SEO signal
_HREFLANG_RE = re.compile(r'<link\b[^>]*\brel=["\']alternate["\'][^>]*\bhreflang=["\']([^"\']+)["\']', re.IGNORECASE)
_HREFLANG_BASE = re.compile(r'<link\b[^>]*\brel=["\']alternate["\'][^>]*\bhreflang=["\']x-default["\']', re.IGNORECASE)

# Meta robots — direktna indexiranje kontrola
_META_ROBOTS_RE = re.compile(r'<meta\b[^>]*\bname=["\']robots["\'][^>]*\bcontent=["\']([^"\']+)["\']', re.IGNORECASE)


def _extract_meta_meta(html: str) -> dict:
    """Ekstraktuje ključne SEO meta tagove (OG, Twitter, hreflang, robots)."""
    out = {
        "og_title":       (_OG_TITLE_RE.search(html) or [None, None])[1],
        "og_description": (_OG_DESCRIPTION_RE.search(html) or [None, None])[1],
        "og_image":       (_OG_IMAGE_RE.search(html) or [None, None])[1],
        "og_type":        (_OG_TYPE_RE.search(html) or [None, None])[1],
        "og_url":         (_OG_URL_RE.search(html) or [None, None])[1],
        "twitter_card":   (_TW_CARD_RE.search(html) or [None, None])[1],
        "twitter_title":  (_TW_TITLE_RE.search(html) or [None, None])[1],
        "twitter_description": (_TW_DESCRIPTION_RE.search(html) or [None, None])[1],
        "twitter_image":  (_TW_IMAGE_RE.search(html) or [None, None])[1],
        "meta_robots":    (_META_ROBOTS_RE.search(html) or [None, None])[1],
    }
    # Hreflang list
    hreflangs = _HREFLANG_RE.findall(html or "")
    out["hreflangs"] = _uniq(hreflangs)
    out["hreflang_x_default"] = bool(_HREFLANG_BASE.search(html or ""))
    return out


def audit_onpage(pages: list[dict]) -> OnpageResult:
    if not pages:
        return OnpageResult(raw={"empty": True}, score=0, issues=["No pages."])

    # All HTML combined for site-wide pattern matching
    all_html = "\n".join((p.get("html") or "") for p in pages)
    homepage_html = _homepage(pages).get("html", "")

    # 1) Contact info
    emails = _extract_emails(all_html)
    # Filter emails that look like noreply / image filenames
    emails = [e for e in emails if not _DISCARD_EMAIL_DOMAIN_RE.search(e) and "noreply" not in e.lower()]
    emails = list(dict.fromkeys(emails))[:10]  # de-dup, cap
    phones = _extract_phones(all_html)[:10]
    addresses = _extract_addresses(pages[0].get("body_text", ""))

    # 2) Social profiles
    socials = {k: _uniq(re.findall(p, all_html)) for k, p in _SOCIAL.items()}
    social_count = sum(1 for v in socials.values() if v)

    # 3) Analytics (informational — not a positive OR negative signal)
    analytics = {k: bool(re.search(p, all_html)) for k, p in _ANALYTICS.items()}

    # 4) Chat widgets (informational — sales/conversion signal)
    chat = {k: bool(re.search(p, all_html)) for k, p in _CHAT.items()}

    # 5) Cookie banner present?
    cookie_banner = bool(_COOKIE_TEXT_RE.search(homepage_html))

    # 6) CDN / WAF (informational)
    cdn = {k: bool(re.search(p, all_html)) for k, p in _CDN.items()}

    checks = {
        "email_present": len(emails) > 0,
        "phone_present": len(phones) > 0,
        "address_present": len(addresses) > 0,
        "socials_good": social_count >= 3,
        "socials_ok": social_count >= 1,
        "analytics_present": any(analytics.values()),
    }

    # 7) Open Graph + Twitter Card meta tagovi (za share preview na FB, X,
    #    LinkedIn, Discord, Slack…) — kritični za cold outreach jer share-ovani
    #    link u email-u/WhatsApp-u/Slack-u mora imati kvalitetan preview.
    og = _extract_meta_meta(homepage_html)
    og_count = sum(1 for k in ("og_title", "og_description", "og_image") if og.get(k))
    checks["og_complete"] = og_count == 3
    checks["og_partial"] = og_count >= 1
    twitter_count = sum(1 for k in ("twitter_card", "twitter_title", "twitter_description") if og.get(k))
    checks["twitter_card_present"] = twitter_count >= 1
    checks["hreflang_present"] = len(og.get("hreflangs", [])) >= 2
    checks["meta_robots_present"] = bool(og.get("meta_robots"))

    score = _score_checks(checks, social_count=social_count)
    raw = {
        "emails": emails,
        "phones": phones,
        "addresses": addresses[:3],
        "socials": {k: v for k, v in socials.items() if v},
        "social_count": social_count,
        "analytics": analytics,
        "chat_widgets": chat,
        "cdn_or_waf": cdn,
        "cookie_banner_present": cookie_banner,
        # OG / Twitter / hreflang signal — korisno za outreach pitch
        # ("ako šerujete ovaj link na FB-u, korisnik neće videti preview")
        "og_tags": og,
        "og_present_count": og_count,
        "twitter_tags_count": twitter_count,
    }
    issues = _issues_for(checks, raw)
    return OnpageResult(raw=raw, score=score, issues=issues)


def _homepage(pages: list[dict]) -> dict:
    from urllib.parse import urlparse
    for p in pages:
        if urlparse(p.get("url", "")).path.rstrip("/") in ("", "/"):
            return p
    return pages[0]


def _uniq(items: list[str]) -> list[str]:
    seen = []
    for i in items:
        if i not in seen:
            seen.append(i)
    return seen[:5]


def _extract_emails(html: str) -> list[str]:
    matches = _EMAIL_RE.findall(html or "")
    return [m for m in matches if len(m) < 80]


def _extract_phones(html: str) -> list[str]:
    """Extract plausible phone-like strings. Heuristic — strips noise."""
    if not html:
        return []
    candidates = []
    for m in _PHONE_RE.finditer(html):
        cand = m.group(0).strip()
        # Get only digits and plus
        digits = re.sub(r"[^\d+]", "", cand)
        if 8 <= len(digits.replace("+", "")) <= 15:
            candidates.append(cand)
    return _uniq(candidates)


def _extract_addresses(text: str) -> list[str]:
    if not text:
        return []
    found = []
    for m in _STREET_RE.finditer(text):
        # Take the line up to a stop character
        s = m.group(0).strip()
        if len(s) < 200 and len(s) > 6:
            found.append(s)
        if len(found) >= 5:
            break
    return found


def _score_checks(checks: dict, social_count: int) -> int:
    score = 0
    # Email (20)
    if checks["email_present"]:
        score += 20
    # Phone (20)
    if checks["phone_present"]:
        score += 20
    # Address (10)
    if checks["address_present"]:
        score += 10
    # Socials (25) — strong signal that the business is real
    if social_count >= 4:
        score += 25
    elif social_count >= 3:
        score += 20
    elif social_count >= 2:
        score += 14
    elif social_count >= 1:
        score += 8
    # Analytics (10)
    if checks["analytics_present"]:
        score += 10
    # Open Graph (15) — kompletni set = 15, partial = 8
    if checks.get("og_complete"):
        score += 15
    elif checks.get("og_partial"):
        score += 8
    # Twitter Card (5)
    if checks.get("twitter_card_present"):
        score += 5
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out = []
    if not checks["email_present"]:
        out.append("No business email found anywhere on the site.")
    if not checks["phone_present"]:
        out.append("No phone number found on the site.")
    if not checks["address_present"]:
        out.append("No street address detected — local-business trust signal missing.")
    if not checks["socials_ok"]:
        out.append("No social-media profile links found.")
    elif not checks["socials_good"]:
        sc = raw["social_count"]
        out.append(f"Only {sc} social-media profile link. Multi-channel presence is recommended.")
    if not checks["analytics_present"]:
        out.append("No analytics platform detected — site traffic is invisible to the owner.")
    # OG / Twitter / hreflang — share preview u outreach komunikaciji
    og = raw.get("og_tags") or {}
    if checks.get("og_complete"):
        pass  # sve OK
    elif checks.get("og_partial"):
        out.append(
            "Open Graph meta tagovi su nekompletni — share preview na Facebook/LinkedIn/WhatsApp/Slack "
            "neće imati dobar preview (nedostaju og:title/description/image)."
        )
    else:
        out.append(
            "Nema Open Graph meta tagova — deljeni link neće imati preview na društvenim mrežama "
            "i u porukama (Facebook, X, LinkedIn, Slack)."
        )
    if not checks.get("twitter_card_present"):
        out.append("Twitter Card meta tagovi nisu podešeni — deljenje na X/Twitter nema preview.")
    return out
