"""Domain creation date lookup — Phase 8.

Two-step strategy:

1. **RDAP first** (HTTP, no auth) — ``https://rdap.org/domain/{domain}``
   Returns JSON. ``events[*].eventAction == "registration"`` has the date.
   Works for most gTLDs and many ccTLDs.

2. **Raw WHOIS over TCP** for ``.rs`` and as a generic fallback —
   ``whois.iana.org`` returns the authoritative WHOIS server for any TLD;
   we then query that server on port 43 and parse the text.

Both paths are best-effort: failures bubble up a ``None`` so the audit row
gets ``site_domain_age_years = None`` instead of failing the whole audit.
"""

from __future__ import annotations

import asyncio
import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

LOG = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) maps-cold-calling/0.1 "
    "(https://github.com/local/maps-cold-calling)"
)

# WHOIS servers looked up via IANA if not listed here.
# (kept sparse — we still go through IANA otherwise)
_WHOIS_BY_TLD: dict[str, str] = {
    "rs": "whois.rnids.rs",
}


@dataclass
class DomainInfo:
    domain: str | None = None
    created: str | None = None          # ISO 8601 date (or full datetime)
    age_years: float | None = None      # rounded to .1
    registrar: str | None = None
    source: str | None = None           # "rdap" | "whois" | None
    error: str | None = None


# ────────────── RDAP path ──────────────

async def _rdap_lookup(domain: str) -> DomainInfo:
    """Try ``rdap.org`` for the domain."""
    info = DomainInfo(domain=domain, source="rdap")
    url = f"https://rdap.org/domain/{domain}"
    try:
        async with httpx.AsyncClient(
            timeout=httpx.Timeout(10.0, connect=5.0),
            follow_redirects=True,
            headers={"User-Agent": UA, "Accept": "application/rdap+json"},
        ) as client:
            resp = await client.get(url)
    except httpx.HTTPError as exc:
        info.error = f"rdap: {type(exc).__name__}: {exc}"
        return info

    if resp.status_code == 404:
        info.error = "rdap: 404 not found (no RDAP for TLD)"
        return info
    if resp.status_code >= 400:
        info.error = f"rdap: HTTP {resp.status_code}"
        return info

    try:
        data = resp.json()
    except Exception as exc:  # noqa: BLE001
        info.error = f"rdap: json parse: {exc}"
        return info

    # events array — registration date
    for ev in data.get("events", []) or []:
        action = (ev.get("eventAction") or "").lower()
        if action in ("registration", "created", "domain creation"):
            when = ev.get("eventDate") or ev.get("date")
            if when:
                info.created = _normalize_iso(when)
                break

    # registrar
    entities = data.get("entities") or []
    for ent in entities:
        roles = ent.get("roles") or []
        if "registrar" in roles:
            vcard = ent.get("vcardArray") or []
            if isinstance(vcard, list) and len(vcard) >= 2:
                fields = vcard[1] if isinstance(vcard[1], list) else []
                for f in fields:
                    if isinstance(f, list) and len(f) >= 4 and f[0] == "fn":
                        name = f[3]
                        if isinstance(name, str):
                            info.registrar = name.strip()[:120]
                            break
            break

    if info.created:
        info.age_years = _years_since(info.created)
    return info


# ────────────── WHOIS path (port 43) ──────────────

_WHOIS_CREATION_PATTERNS: tuple[re.Pattern[str], ...] = (
    # RNIDS (Serbia) and many ccTLDs
    re.compile(r"^\s*Domain (?:Registration Date|registration date|creation date)\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Registration date\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Creation Date\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Created(?:\s+On)?\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Registered(?:\s+On)?\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Registered Date\s*:\s*(\S.*)$", re.IGNORECASE | re.MULTILINE),
)

_WHOIS_REGISTRAR_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"^\s*Registrar\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
    re.compile(r"^\s*Sponsoring Registrar\s*:\s*(.+)$", re.IGNORECASE | re.MULTILINE),
)


async def _resolve_whois_server(tld: str) -> str | None:
    """Get the authoritative WHOIS server for a TLD via IANA."""
    try:
        reader, writer = await asyncio.open_connection("whois.iana.org", 43)
    except Exception as iana_exc:  # noqa: BLE001
        LOG.debug("whois: IANA connect failed: %s", iana_exc)
        return None
    try:
        writer.write((tld + "\r\n").encode())
        await writer.drain()
        data = await asyncio.wait_for(reader.read(8192), timeout=8.0)
    except Exception:  # noqa: BLE001
        return None
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass
    text = data.decode("utf-8", errors="replace")
    for line in text.splitlines():
        if line.lower().startswith("whois:"):
            return line.split(":", 1)[1].strip()
    return None


async def _whois_query(server: str, domain: str) -> str | None:
    try:
        reader, writer = await asyncio.open_connection(server, 43)
    except Exception as exc:  # noqa: BLE001
        LOG.debug("whois: %s connect failed: %s", server, exc)
        return None
    try:
        writer.write((domain + "\r\n").encode())
        await writer.drain()
        chunks: list[bytes] = []
        while True:
            chunk = await asyncio.wait_for(reader.read(4096), timeout=8.0)
            if not chunk:
                break
            chunks.append(chunk)
            if sum(len(c) for c in chunks) > 200_000:
                break
        return b"".join(chunks).decode("utf-8", errors="replace")
    except Exception as exc:  # noqa: BLE001
        LOG.debug("whois: %s query failed: %s", server, exc)
        return None
    finally:
        try:
            writer.close()
            await writer.wait_closed()
        except Exception:  # noqa: BLE001
            pass


def _parse_whois_response(text: str) -> tuple[str | None, str | None]:
    created: str | None = None
    registrar: str | None = None
    for pat in _WHOIS_CREATION_PATTERNS:
        m = pat.search(text)
        if m:
            created = m.group(1).strip()
            break
    for pat in _WHOIS_REGISTRAR_PATTERNS:
        m = pat.search(text)
        if m:
            registrar = m.group(1).strip()[:200]
            break
    return created, registrar


async def _whois_lookup(domain: str) -> DomainInfo:
    info = DomainInfo(domain=domain, source="whois")
    parts = domain.split(".")
    if len(parts) < 2:
        info.error = "whois: invalid domain"
        return info
    tld = parts[-1].lower()
    server = _WHOIS_BY_TLD.get(tld)
    if not server:
        server = await _resolve_whois_server(tld)
    if not server:
        info.error = "whois: could not resolve authoritative server"
        return info
    text = await _whois_query(server, domain)
    if not text:
        info.error = f"whois: empty response from {server}"
        return info
    raw_created, registrar = _parse_whois_response(text)
    if raw_created:
        info.created = _normalize_date(raw_created)
    if registrar:
        info.registrar = registrar
    if info.created:
        info.age_years = _years_since(info.created)
    return info


# ────────────── helpers ──────────────

def _normalize_iso(s: str) -> str | None:
    """Normalize a date-ish string to ISO yyyy-mm-dd (drop time)."""
    s = s.strip()
    if not s:
        return None
    # RFC 3339 datetime
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.date().isoformat()
    except Exception:  # noqa: BLE001
        pass
    # Plain yyyy-mm-dd
    m = re.match(r"^(\d{4}-\d{2}-\d{2})", s)
    if m:
        return m.group(1)
    return None


def _normalize_date(s: str) -> str | None:
    """Try a small set of date formats commonly found in WHOIS responses."""
    s = s.strip()
    if not s:
        return None
    if not s:
        return None
    s = s.replace("/", "-")
    # ``DD.MM.YYYY`` is the RNIDS (Serbia) standard — handled before the
    # general dotted -> dashed replacement.
    if re.match(r"^\d{1,2}\.\d{1,2}\.\d{4}", s):
        s = s.replace(".", "-")
    formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M",
        "%Y-%m-%d",
        "%d-%m-%Y %H:%M:%S",
        "%d-%m-%Y %H:%M",
        "%d-%m-%Y",
        "%Y-%m-%dT%H:%M:%S",
    )
    for fmt in formats:
        try:
            dt = datetime.strptime(s.split(".")[0], fmt)
            return dt.date().isoformat()
        except ValueError:
            continue
    return _normalize_iso(s)


def _years_since(iso_date: str) -> float | None:
    try:
        dt = datetime.strptime(iso_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    except ValueError:
        return None
    delta = datetime.now(timezone.utc) - dt
    return round(delta.days / 365.25, 1)


async def lookup(domain: str | None) -> DomainInfo:
    """RDAP-first, WHOIS-fallback, never raise."""
    if not domain:
        return DomainInfo(error="no domain")
    domain = domain.strip().lower()
    # Apex-ify: whois/rdap are registered-domain lookups, not host lookups.
    # Strip a leading ``www.`` and any subdomain to leave just
    # ``example.co.uk``-style labels.
    apex = _to_apex(domain)
    info = await _rdap_lookup(apex)
    if info.created:
        info.domain = apex
        return info
    # RDAP didn't give a date — try WHOIS on the apex
    LOG.debug("age: RDAP miss for %s — falling back to WHOIS", apex)
    whois = await _whois_lookup(apex)
    if whois.created:
        whois.domain = apex
        return whois
    if not info.error and not whois.error:
        return DomainInfo(domain=apex, error="age not found in RDAP or WHOIS")
    # prefer the one with more information
    chosen = whois if (whois.created or whois.registrar) else info
    chosen.domain = apex
    return chosen


def _to_apex(host: str) -> str:
    """Best-effort: return the registered-domain (apex) form.

    Examples::

        www.example.com      -> example.com
        a.b.example.co.uk    -> example.co.uk
        example.com          -> example.com
    """
    if not host:
        return host
    host = host.strip().lower().rstrip(".")
    if not host:
        return host
    parts = host.split(".")
    if len(parts) <= 2:
        return host
    # Known multi-label public suffixes — extend as needed.
    multi_label_suffixes = {
        ("co", "uk"), ("co", "rs"), ("co", "jp"), ("com", "au"),
        ("com", "br"), ("org", "uk"), ("ac", "uk"), ("gov", "uk"),
        ("com", "cn"), ("com", "hk"), ("com", "tr"), ("com", "tw"),
    }
    last_two = tuple(parts[-2:])
    if last_two in multi_label_suffixes and len(parts) >= 3:
        return ".".join(parts[-3:])
    return ".".join(parts[-2:])


__all__ = ["DomainInfo", "lookup"]
