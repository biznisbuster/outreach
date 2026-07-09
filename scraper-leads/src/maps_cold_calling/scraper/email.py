"""Email extraction from business websites.

Phase 4 — opt-in via ``--extract-emails``. Gated by the presence of a
``website`` field; businesses without a website are skipped silently.

Strategy (deliberately conservative):
1. ``httpx.AsyncClient`` GET with a short timeout and a polite UA.
2. Look for ``mailto:`` links first (highest signal).
3. Fall back to regex over the visible text, handling common obfuscations.

We do NOT crawl the homepage deeper than the GET itself — that would blow the
blast radius on third-party sites. ``--extract-emails`` is opt-in but
non-aggressive by default.
"""

from __future__ import annotations

import asyncio
import logging
import re

import httpx

LOG = logging.getLogger(__name__)

USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)

# Polite defaults.
CONNECT_TIMEOUT_S = 5.0
READ_TIMEOUT_S = 10.0
DEFAULT_DELAY_S = 1.5

# Regex for real emails (RFC 5322 lazy version). Allows alnum + dot/dash/underscore/plus.
EMAIL_RE = re.compile(r"\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b")

# Obfuscation patterns: replace common variants with @ and . before running
# the regex. Order matters.
OBFUSCATION_MAP: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\s*\[\s*at\s*\]\s*", re.IGNORECASE), "@"),
    (re.compile(r"\s*\(\s*at\s*\)\s*", re.IGNORECASE), "@"),
    (re.compile(r"\s+at\s+", re.IGNORECASE), "@"),
    (re.compile(r"\s*\[\s*dot\s*\]\s*", re.IGNORECASE), "."),
    (re.compile(r"\s*\(\s*dot\s*\)\s*", re.IGNORECASE), "."),
    (re.compile(r"\s+dot\s+", re.IGNORECASE), "."),
    (re.compile(r"&#64;", re.IGNORECASE), "@"),
    (re.compile(r"&#46;", re.IGNORECASE), "."),
    (re.compile(r"\s+@\s+"), "@"),
)


def _deobfuscate(text: str) -> str:
    out = text
    for pat, repl in OBFUSCATION_MAP:
        out = pat.sub(repl, out)
    return out


def _looks_like_email(s: str) -> bool:
    if "@" not in s or "." not in s:
        return False
    if " " in s:
        return False
    return bool(EMAIL_RE.search(s))


def _extract_from_text(html_or_text: str) -> str | None:
    """Find the first plausible email in ``html_or_text``.

    We prefer ``mailto:`` (rendered HTML) when available, then fall back to
    the deobfuscated text scan.
    """
    # 1) mailto: extraction
    for m in re.finditer(r"mailto:\s*([^?\"'>]+)", html_or_text, re.IGNORECASE):
        candidate = m.group(1).strip()
        if _looks_like_email(candidate):
            return candidate.lower()
    # 2) Direct regex over raw
    for m in EMAIL_RE.finditer(html_or_text):
        cand = m.group(0).lower()
        if _looks_like_email(cand):
            return cand
    # 3) After deobfuscation
    deob = _deobfuscate(html_or_text)
    if deob != html_or_text:
        for m in EMAIL_RE.finditer(deob):
            cand = m.group(0).lower()
            if _looks_like_email(cand):
                return cand
    return None


async def extract_email(
    url: str,
    *,
    delay_s: float = DEFAULT_DELAY_S,
    client: httpx.AsyncClient | None = None,
) -> str | None:
    """Fetch a website and return the first plausible email, else ``None``.

    Polite delay before fetching (configurable).
    """
    if not url:
        return None
    # Throttle first.
    await asyncio.sleep(delay_s)

    owns_client = client is None
    if owns_client:
        client = httpx.AsyncClient(
            timeout=httpx.Timeout(READ_TIMEOUT_S, connect=CONNECT_TIMEOUT_S),
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT},
        )
    try:
        try:
            r = await client.get(url)
        except (httpx.HTTPError, Exception) as exc:
            LOG.debug("email: GET %s failed: %s", url[:80], exc)
            return None
        if r.status_code >= 400:
            LOG.debug("email: GET %s -> HTTP %d", url[:80], r.status_code)
            return None
        # Quick filter: skip if no text-content probable
        if "html" not in r.headers.get("content-type", "").lower() and r.text:
            return _extract_from_text(r.text)
        return _extract_from_text(r.text)
    finally:
        if owns_client and client is not None:
            await client.aclose()


__all__ = ["extract_email"]
