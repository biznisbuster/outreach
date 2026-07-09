"""Enrichment endpoint — za postojeće leadove bez reviews_count/google_rating,
koristi scrape-leads servis (Google Maps) da nađe mesto i dopuni podatke.

Ne otvaramo novi CLI endpoint — koristimo već postojeći /scrape-leads servis
koji već ima (category, city) → listu biznisa sa reviews_count.
Taj servis nam je jedini izvor Google Maps podataka.
"""
from __future__ import annotations

import logging
import re
from difflib import SequenceMatcher
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import __version__ as _v  # noqa

LOG = logging.getLogger("maps_cold_calling.enrich")

router = APIRouter()


# Google Maps place URL-ovi imaju !19sChIJ... deo sa place_id.
# Npr. https://www.google.com/maps/place/.../data=!4m7!3m6!1s0x...!8m2!3d...!4d...!16s%2Fg%2F...!19sChIJC1fBWeOpV0cRa04OP_ePetg
_PLACE_ID_RE = re.compile(r"!19s(ChI[A-Za-z0-9_-]+)")
_PLACE_ID_RE2 = re.compile(r"/(ChI[A-Za-z0-9_-]+)/?")


def _extract_place_id(url: str) -> str | None:
    m = _PLACE_ID_RE.search(url)
    if m:
        return m.group(1)
    m = _PLACE_ID_RE2.search(url)
    if m:
        return m.group(1)
    return None


class EnrichReq(BaseModel):
    name: str = Field(..., min_length=1)
    city: str = Field(..., min_length=1)
    category: str | None = None
    country: str = Field("RS", min_length=2, max_length=2)
    max_results: int = Field(8, ge=1, le=20)


def _norm(s: str) -> str:
    """Uklanjamo sve što nije slovo/cifra i lower-ujemo. Za fuzzy match."""
    s = s.lower()
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def _similarity(a: str, b: str) -> float:
    return SequenceMatcher(None, _norm(a), _norm(b)).ratio()


@router.post("/enrich-lead")
async def enrich_lead(req: EnrichReq) -> dict[str, Any]:
    """Pronađi biznis u Google Maps po (name, city) i vrati dopunske podatke.

    Strategija:
    1) Pokušaj query sa imenom biznisa kao category (precizan match)
    2) Ako 0 rezultata, fallback na req.category (opštiji upit)
    3) Fuzzy match po imenu, threshold 0.55
    4) Vrati best-match podatke
    """
    from . import api as scraper_api
    from .api import ScrapeReq, _JOBS  # late import — avoids api↔enrich circular import
    import asyncio

    async def _try_query(q: str) -> tuple[str | None, list[dict]]:
        """Vrati (jobId, rows) za dati query ili (None, []) ako ne uspe."""
        scrape_model = ScrapeReq(
            category=q,
            city=req.city,
            country=req.country,
            language="sr",
            max_results=req.max_results,
            extract_emails=False,
            stealth="lite",
        )
        try:
            r = await scraper_api.start_scrape(scrape_model)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(503, f"Scrape-leads servis greška: {exc}") from exc

        job_id = r.get("jobId")
        if not job_id:
            return None, []

        # poll za status (max 70s)
        for _ in range(70):
            await asyncio.sleep(1)
            job = _JOBS.get(job_id)
            if not job:
                continue
            s = job.status
            if s in ("done", "empty", "failed", "captcha"):
                break
        job = _JOBS.get(job_id)
        if not job or job.status != "done":
            return job_id, []
        res = await scraper_api.import_results(job_id)
        return job_id, res.get("rows", [])

    # 1) Pokušaj sa imenom biznisa
    last_job_id: str | None = None
    rows: list[dict] = []
    if req.name and req.name.strip() and len(req.name.strip()) >= 3:
        last_job_id, rows = await _try_query(req.name.strip())
    # 2) Fallback na category
    if not rows and req.category and req.category.strip() and req.category.strip() != req.name:
        last_job_id, rows = await _try_query(req.category.strip())
    # 3) Ako još nema, pokušaj generički "biznis" upit
    if not rows:
        last_job_id, rows = await _try_query("firma")

    if not rows:
        return {
            "match": None,
            "reason": f"Google Maps vratio 0 rezultata za '{req.name}' u '{req.city}' (pokušano sa name, category, generički)",
            "jobId": last_job_id,
        }

    scored = []
    for row in rows:
        sim = _similarity(req.name, row.get("name") or "")
        scored.append((sim, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    best_sim, best_row = scored[0]
    if best_sim < 0.45:
        return {
            "match": None,
            "reason": f"Nema dovoljno sličnog mesta (best match '{best_row.get('name')}' = {best_sim:.0%})",
            "jobId": last_job_id,
            "bestMatchName": best_row.get("name"),
            "bestMatchScore": round(best_sim, 2),
        }

    return {
        "match": True,
        "confidence": round(best_sim, 2),
        "jobId": last_job_id,
        "data": {
            "name": best_row.get("name"),
            "google_place_id": best_row.get("google_place_id"),
            "google_maps_url": best_row.get("google_maps_url"),
            "google_rating": best_row.get("rating"),
            "reviews_count": best_row.get("reviews_count"),
            "phone_raw": best_row.get("phone_raw"),
            "phone_e164": best_row.get("phone_e164"),
            "website": best_row.get("website"),
            "email": best_row.get("email"),
            "address": best_row.get("address"),
            "city": best_row.get("city"),
            "category": best_row.get("category"),
            "latitude": best_row.get("latitude"),
            "longitude": best_row.get("longitude"),
        },
    }

    # 3) uzmi CSV i nađi best match
    res = await scraper_api.import_results(job_id)
    rows = res.get("rows", [])
    if not rows:
        return {"match": None, "reason": "Google Maps vratio 0 rezultata", "jobId": job_id}

    target = _norm(req.name)
    scored = []
    for row in rows:
        sim = _similarity(req.name, row.get("name") or "")
        scored.append((sim, row))
    scored.sort(key=lambda x: x[0], reverse=True)
    best_sim, best_row = scored[0]
    if best_sim < 0.55:
        return {
            "match": None,
            "reason": f"Nema dovoljno sličnog mesta (best match '{best_row.get('name')}' = {best_sim:.0%})",
            "jobId": job_id,
            "bestMatchName": best_row.get("name"),
            "bestMatchScore": round(best_sim, 2),
        }

    return {
        "match": True,
        "confidence": round(best_sim, 2),
        "jobId": job_id,
        "data": {
            "name": best_row.get("name"),
            "google_place_id": best_row.get("google_place_id"),
            "google_maps_url": best_row.get("google_maps_url"),
            "google_rating": best_row.get("rating"),
            "reviews_count": best_row.get("reviews_count"),
            "phone_raw": best_row.get("phone_raw"),
            "phone_e164": best_row.get("phone_e164"),
            "website": best_row.get("website"),
            "email": best_row.get("email"),
            "address": best_row.get("address"),
            "city": best_row.get("city"),
            "category": best_row.get("category"),
            "latitude": best_row.get("latitude"),
            "longitude": best_row.get("longitude"),
        },
    }


class EnrichUrlReq(BaseModel):
    url: str = Field(..., min_length=10)
    city: str | None = None
    country: str = Field("RS", min_length=2, max_length=2)
    # Ako znamo grad, koristimo ga za scrape browser konteksta.
    # Ako ne, koristimo prazan string pa ćemo fallback na /enrich-lead semantiku.
    max_results: int = Field(20, ge=1, le=40)


@router.post("/enrich-url")
async def enrich_url(req: EnrichUrlReq) -> dict[str, Any]:
    """Enrich lead-a DIREKTNO po Google Maps URL-u — bez fuzzy matcha.

    Ako URL sadrži ``!19sChIJ...`` (place_id), pokreni scrape sa imenom
    biznisa iz URL-a kao query, pa u rezultatima nađi red sa istim
    ``google_place_id``. Ovo je 100% tačan match.

    Ako URL nema place_id (npr. samo ``maps/place/Some+Name`` bez data bloka),
    fallback na fuzzy match po imenu.
    """
    from . import api as scraper_api
    from .api import ScrapeReq, _JOBS  # late import
    import asyncio

    place_id = _extract_place_id(req.url)
    city = req.city or ""

    # Izvuci ime iz URL-a — ono je uvek između /place/ i /data=
    name_hint = None
    if "/place/" in req.url:
        try:
            name_hint = req.url.split("/place/")[1].split("/")[0].replace("+", " ")
        except Exception:  # noqa: BLE001
            pass

    if not place_id and not name_hint:
        return {
            "match": None,
            "reason": "URL nema place_id ni čitljivo ime biznisa.",
        }

    if not city:
        return {
            "match": None,
            "reason": "Potreban je `city` da se pokrene browser pretraga.",
            "googlePlaceId": place_id,
            "nameHint": name_hint,
        }

    # Ako nema place_id, fallback na fuzzy /enrich-lead
    if not place_id:
        return await enrich_lead(EnrichReq(
            name=name_hint or "",
            city=city,
            country=req.country,
            max_results=req.max_results,
        ))

    LOG.info("enrich-url: place_id=%s city=%s name_hint=%r", place_id, city, name_hint)

    # Pokreni scrape koristeći ime biznisa kao search query (bez fuzzy matcha).
    # max_results veći je bolji — više šanse da naš biznis bude u rezultatima.
    scrape_model = ScrapeReq(
        category=name_hint or "_enrich_",
        city=city,
        country=req.country,
        language="sr",
        max_results=req.max_results,
        extract_emails=False,
        stealth="lite",
    )
    try:
        r = await scraper_api.start_scrape(scrape_model)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"Scrape-leads servis greška: {exc}") from exc

    job_id = r.get("jobId")
    if not job_id:
        return {"match": None, "reason": "Scrape servis vratio prazan jobId", "googlePlaceId": place_id}

    for _ in range(70):
        await asyncio.sleep(1)
        job = _JOBS.get(job_id)
        if job and job.status in ("done", "empty", "failed", "captcha"):
            break

    job = _JOBS.get(job_id)
    if not job or job.status != "done":
        return {"match": None, "reason": f"Scrape job završio sa status={job.status if job else '?'}", "jobId": job_id, "googlePlaceId": place_id}

    res = await scraper_api.import_results(job_id)
    rows = res.get("rows", [])

    # 100% tačan match po place_id
    match = None
    for row in rows:
        if row.get("google_place_id") == place_id:
            match = row
            break

    if not match:
        return {
            "match": None,
            "reason": (
                f"Place ID {place_id} nije pronađen među prvih {req.max_results} "
                f"rezultata za '{name_hint}' u gradu {city}. Povećaj max_results "
                f"ili koristi fuzzy enrich."
            ),
            "jobId": job_id,
            "googlePlaceId": place_id,
            "rowsReturned": len(rows),
        }

    return {
        "match": True,
        "confidence": 1.0,
        "source": "url",
        "jobId": job_id,
        "googlePlaceId": place_id,
        "data": {
            "name": match.get("name"),
            "google_place_id": match.get("google_place_id"),
            "google_maps_url": match.get("google_maps_url"),
            "google_rating": match.get("rating"),
            "reviews_count": match.get("reviews_count"),
            "phone_raw": match.get("phone_raw"),
            "phone_e164": match.get("phone_e164"),
            "website": match.get("website"),
            "email": match.get("email"),
            "address": match.get("address"),
            "city": match.get("city"),
            "category": match.get("category"),
            "latitude": match.get("latitude"),
            "longitude": match.get("longitude"),
        },
    }


__all__ = ["router", "enrich_lead", "enrich_url"]