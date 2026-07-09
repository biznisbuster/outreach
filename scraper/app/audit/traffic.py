"""External traffic / authority signals.

Two providers, both **free**:

* **Tranco** — popularity ranking (the closer to 0, the more-visited the site).
  No API key. We hit the single-domain endpoint and cache the result on disk.
  Endpoint: https://tranco-list.eu/api/ranks/domain/{domain}

* **Open PageRank** — 0-10 domain authority score. Requires API key (free).
  Endpoint: https://openpagerank.com/api/v1.0/domainInfo

Both providers are off-by-default if env vars are unset / errors occur — the
audit must still run and produce a useful score even without any external data.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Optional

import httpx


# ---------------------------------------------------------------------------
# Paths and tunables
# ---------------------------------------------------------------------------

TRANCO_CACHE = Path(os.environ.get("TRANCO_CACHE_DIR", "data/tranco_cache"))
TRANCO_TTL_SEC = int(os.environ.get("TRANCO_TTL_SEC", str(7 * 86400)))  # 7 days

OPENPAGERANK_CACHE = Path(os.environ.get("OPENPAGERANK_CACHE_DIR", "data/openpagerank_cache"))
OPENPAGERANK_TTL_SEC = int(os.environ.get("OPENPAGERANK_TTL_SEC", str(86400)))  # 24 h

# ---------------------------------------------------------------------------
# Tranco
# ---------------------------------------------------------------------------

TRANCO_API = "https://tranco-list.eu/api/ranks/domain/{domain}"


def _cache_get(path: Path, ttl: int):
    if not path.exists():
        return None
    age = time.time() - path.stat().st_mtime
    if age > ttl:
        return None
    try:
        return json.loads(path.read_text())
    except Exception:
        return None


def _cache_put(path: Path, value: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(value))
    except Exception:
        pass


def tranco_rank(domain: str) -> Optional[dict]:
    """Return ``{"rank": int}`` for the latest available date or ``None``.

    ``domain`` should be e.g. ``example.com`` (no scheme).
    """
    domain = (domain or "").lower().strip()
    if not domain:
        return None
    cache_file = TRANCO_CACHE / f"{domain}.json"

    cached = _cache_get(cache_file, TRANCO_TTL_SEC)
    if cached is not None:
        return cached

    try:
        with httpx.Client(timeout=15, follow_redirects=True) as c:
            r = c.get(TRANCO_API.format(domain=domain))
        if r.status_code != 200:
            return None
        data = r.json()
        ranks = data.get("ranks") or []
        if not ranks:
            # Honest: domain is not in Tranco's top 1M. Return a special marker
            # so the note can say so explicitly — the site still scores, it
            # just gets 0 for the Tranco portion.
            return {"rank": None, "in_top_1m": False}
        rank = ranks[0].get("rank")
        if rank is None:
            return {"rank": None, "in_top_1m": False}
        result = {"rank": int(rank), "date": ranks[0].get("date"), "in_top_1m": True}
        _cache_put(cache_file, result)
        return result
    except Exception as e:
        print(f"[traffic] Tranco lookup failed for {domain}: {e}")
        return None


# ---------------------------------------------------------------------------
# Open PageRank
# ---------------------------------------------------------------------------

OPENPAGERANK_URL = "https://openpagerank.com/api/v1.0/domainInfo"


def open_page_rank(domain: str, api_key: Optional[str] = None) -> Optional[dict]:
    """Return ``{"rank": float, "rank_decimal": int}`` or ``None``.

    Cached per-domain for 24h.
    """
    api_key = api_key or os.environ.get("OPENPAGERANK_API_KEY")
    domain = (domain or "").lower().strip()
    if not api_key or not domain:
        return None

    cache_file = OPENPAGERANK_CACHE / f"{domain}.json"
    cached = _cache_get(cache_file, OPENPAGERANK_TTL_SEC)
    if cached is not None:
        return cached

    try:
        with httpx.Client(timeout=15, follow_redirects=True) as c:
            r = c.get(
                OPENPAGERANK_URL,
                params={"domains[]": domain},
                headers={"API-OPR": api_key},
            )
        if r.status_code != 200:
            return None
        data = r.json()
        items = data.get("response") or data.get("ranks") or []
        if not items:
            return None
        entry = items[0]
        rank = entry.get("page_rank_decimal")
        if rank is None:
            return None
        result = {"rank": float(rank) / 10.0, "rank_decimal": int(rank)}
        _cache_put(cache_file, result)
        return result
    except Exception as e:
        print(f"[traffic] OpenPageRank lookup failed for {domain}: {e}")
        return None


# ---------------------------------------------------------------------------
# Combined provider — called from runner.py
# ---------------------------------------------------------------------------

def traffic_signals(domain: str) -> dict:
    """Aggregate everything that's available, plus a "skipped" reason if not."""
    tranco = tranco_rank(domain)
    opr = open_page_rank(domain)

    return {
        "domain": domain,
        "tranco": tranco,
        "open_page_rank": opr,
        "visitor_count": None,
        "top_pages": None,
        "provider_notes": {
            "tranco": _tranco_note(tranco),
            "open_page_rank": _opr_note(opr),
            "visitor_count": "no free provider; consider SimilarWeb (paid) if needed",
        },
    }


def _tranco_note(tranco) -> str:
    if tranco and tranco.get("rank") is not None:
        return f"rank #{tranco['rank']} (date {tranco.get('date','?')})"
    if tranco and tranco.get("rank") is None:
        return "not in Tranco top-1M (small site — expected for local businesses)"
    return "API call failed"


def _opr_note(opr) -> str:
    if opr and opr.get("rank") is not None:
        return f"Open PageRank {opr['rank']}/10"
    if not os.environ.get("OPENPAGERANK_API_KEY"):
        return "no OPENPAGERANK_API_KEY env var set"
    return "API call failed"
