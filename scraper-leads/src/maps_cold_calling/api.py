"""FastAPI HTTP wrapper around the maps_cold_calling CLI.

Spawns the scraper as a subprocess per the project's README §8.1 (recommended v1
integration pattern) so a Playwright crash cannot take down the webapp.

Endpoints:
  POST /scrape-leads          → start a job, return job_id
  GET  /scrape-leads/status/{job_id}  → progress + CSV path on completion
  POST /scrape-leads/import   → parse finished CSV into Business JSON rows
  GET  /health                → liveness probe

Storage layout (env-overridable):
  RUNS_DIR/    — one subdir per job containing the CSV + log
"""
from __future__ import annotations

import asyncio
import csv
import json
import logging
import os
import subprocess
import sys
import time
import uuid
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field, model_validator

from maps_cold_calling.changelog_api import get_changelog

LOG = logging.getLogger("maps_cold_calling.api")

# VAŽNO: RUNS_DIR MORA biti apsolutna putanja. Api.py ga čita iz svog CWD-a
# (scraper-leads/), a subprocess iz svog CWD-a (gui/, project root) — relativna
# putanja tipa "../data/scraper-runs" bi bila različito interpretirana i CSV
# bi završio u pogrešnom diru. resolve() osigurava da je putanja uvek apsolutna.
RUNS_DIR = Path(os.environ.get("RUNS_DIR", "/data/scraper-runs")).resolve()
RUNS_DIR.mkdir(parents=True, exist_ok=True)
JOB_TIMEOUT_SEC = int(os.environ.get("JOB_TIMEOUT_SEC", "900"))  # 15-min hard cap

CSV_COLUMNS = [
    "name",
    "address",
    "city",
    "country",
    "phone_e164",
    "phone_raw",
    "website",
    "email",
    "category",
    "rating",
    "reviews_count",
    "latitude",
    "longitude",
    "google_place_id",
    "google_maps_url",
    "hours_json",
    "source",
    "scraped_at",
]


@dataclass
class Job:
    job_id: str
    query: str | None = None
    category: str = ""
    city: str = ""
    country: str = "RS"
    max_results: int | None = None
    extract_emails: bool = False
    language: str = "sr"
    stealth: str = "lite"
    status: str = "queued"  # queued | running | done | empty | captcha | failed
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    csv_path: str | None = None
    log_path: str | None = None
    progress_path: str | None = None
    exit_code: int | None = None
    error: str | None = None
    rows_written: int = 0
    _proc: subprocess.Popen | None = None
    _task: asyncio.Task | None = None


_JOBS: dict[str, Job] = {}

app = FastAPI(title="maps-cold-calling-api", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Enrichment router (fuzzy Google Maps lookup za postojeće leadove)
from maps_cold_calling.enrich import router as enrich_router

app.include_router(enrich_router)


@app.get("/scrape-leads/changelog")
async def changelog(limit: int = 12) -> dict[str, Any]:
    """Vraća poslednje unose iz CHANGELOG.md scraper-leads projekta."""
    return get_changelog(limit=limit)


class ScrapeReq(BaseModel):
    # NOVO: ceo search prompt (npr. "cvecare beograd") — alternativno umesto
    # category+city kad GUI ne želi da parsira grad iz teksta.
    query: str | None = Field(None, min_length=2, description="Full search query (alternative to category+city)")
    category: str | None = Field(None, min_length=2)
    city: str | None = Field(None, min_length=1)
    country: str = Field("RS", min_length=2, max_length=2)
    language: str = "sr"
    max_results: int | None = Field(20, ge=1, le=500)
    extract_emails: bool = False
    stealth: str = Field("lite", pattern="^(off|lite|standard|aggressive)$")

    @model_validator(mode="after")
    def _check_query_or_cat_city(self) -> "ScrapeReq":
        if not self.query and not (self.category and self.city):
            raise ValueError("Potrebno je 'query' ILI ('category' i 'city')")
        return self


def _job_dir(job_id: str) -> Path:
    d = RUNS_DIR / job_id
    d.mkdir(parents=True, exist_ok=True)
    return d


def _build_cmd(job: Job, out_csv: Path, progress_file: Path) -> list[str]:
    # Ako je job.query prosleđen (novi mod), ceo string ide kao --query.
    # Inače fallback na stari --category + --city.
    if job.query:
        cmd: list[str] = [
            sys.executable,
            "-m",
            "maps_cold_calling",
            "--query",
            job.query,
        ]
    else:
        cmd = [
            sys.executable,
            "-m",
            "maps_cold_calling",
            "--category",
            job.category,
            "--city",
            job.city,
        ]
    cmd.extend([
        "--country",
        job.country,
        "--language",
        job.language,
        "--stealth",
        job.stealth,
        "--on-captcha",
        "skip",
        "--output",
        str(out_csv),
        "--progress-file",
        str(progress_file),
    ])
    if job.max_results is not None:
        cmd.extend(["--max-results", str(job.max_results)])
    if job.extract_emails:
        cmd.append("--extract-emails")
    return cmd


async def _run_job(job: Job) -> None:
    out_dir = _job_dir(job.job_id)
    out_csv = out_dir / "leads.csv"
    log_path = out_dir / "scraper.log"
    progress_path = out_dir / "progress.json"
    job.csv_path = str(out_csv)
    job.log_path = str(log_path)
    job.progress_path = str(progress_path)
    job.status = "running"

    cmd = _build_cmd(job, out_csv, progress_path)
    LOG.info("[%s] starting: %s", job.job_id, " ".join(cmd))

    env = {**os.environ, "PYTHONUNBUFFERED": "1"}

    try:
        with log_path.open("w") as logf:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=Path(__file__).resolve().parent.parent.parent.parent,
                stdout=logf,
                stderr=asyncio.subprocess.STDOUT,
                env=env,
            )
            job._proc = proc
            try:
                rc = await asyncio.wait_for(proc.wait(), timeout=JOB_TIMEOUT_SEC)
            except asyncio.TimeoutError:
                proc.kill()
                await proc.wait()
                job.status = "failed"
                job.error = f"timeout after {JOB_TIMEOUT_SEC}s"
                job.finished_at = time.time()
                LOG.error("[%s] %s", job.job_id, job.error)
                return

        job.exit_code = rc
        if rc == 0:
            if out_csv.exists():
                with out_csv.open() as f:
                    job.rows_written = sum(1 for _ in csv.DictReader(f))
                job.status = "done" if job.rows_written > 0 else "empty"
            else:
                job.status = "empty"
        elif rc == 2:
            job.status = "empty"
            job.error = "no results — empty query or rate-limited"
        elif rc == 3:
            job.status = "captcha"
            job.error = "captcha triggered — back off and retry later"
        else:
            job.status = "failed"
            tail = log_path.read_text(errors="replace")[-1000:]
            job.error = f"scraper exit {rc}: {tail}"
    except Exception as exc:  # noqa: BLE001
        job.status = "failed"
        job.error = f"{type(exc).__name__}: {exc}"
        LOG.exception("[%s] crashed", job.job_id)
    finally:
        job.finished_at = time.time()
        LOG.info(
            "[%s] finished status=%s rows=%d exit=%s",
            job.job_id,
            job.status,
            job.rows_written,
            job.exit_code,
        )


def _job_view(job: Job) -> dict[str, Any]:
    elapsed = (job.finished_at or time.time()) - job.started_at
    return {
        "jobId": job.job_id,
        "status": job.status,
        "query": job.query,
        "category": job.category,
        "city": job.city,
        "country": job.country,
        "maxResults": job.max_results,
        "extractEmails": job.extract_emails,
        "rowsWritten": job.rows_written,
        "elapsedSec": round(elapsed, 1),
        "exitCode": job.exit_code,
        "error": job.error,
        "hasCsv": bool(job.csv_path and Path(job.csv_path).exists()),
        "stage": _current_stage(job),
    }


def _current_stage(job: Job) -> str | None:
    """Čita poslednji progress event iz progress.json fajla (v3 feature)."""
    if not job.progress_path:
        return None
    p = Path(job.progress_path)
    if not p.exists():
        return None
    try:
        snap = json.loads(p.read_text(encoding="utf-8"))
        ev = snap.get("last_event") or {}
        return ev.get("stage")
    except Exception:  # noqa: BLE001
        return None


def _read_progress(job: Job) -> dict[str, Any] | None:
    """Parsira progress.json snapshot i vraća poslednji event + count."""
    if not job.progress_path:
        return None
    p = Path(job.progress_path)
    if not p.exists():
        return None
    try:
        snap = json.loads(p.read_text(encoding="utf-8"))
    except Exception:  # noqa: BLE001
        return None
    return snap


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "maps-cold-calling-api"}


@app.post("/scrape-leads")
async def start_scrape(req: ScrapeReq) -> dict[str, Any]:
    job_id = f"{int(time.time())}_{uuid.uuid4().hex[:6]}"
    # query ima prioritet; category/city se koriste samo ako query nije dat
    job = Job(
        job_id=job_id,
        query=req.query,
        category=req.category or "",
        city=req.city or "",
        country=req.country.upper(),
        max_results=req.max_results,
        extract_emails=req.extract_emails,
        language=req.language,
        stealth=req.stealth,
    )
    _JOBS[job_id] = job
    job._task = asyncio.create_task(_run_job(job))
    return _job_view(job)


@app.get("/scrape-leads/status/{job_id}")
async def job_status(job_id: str) -> dict[str, Any]:
    job = _JOBS.get(job_id)
    if not job:
        # Disk fallback: pokušaj da rekonstruišeš završeni job iz CSV/progress.json
        # (vidno posle restarta servisa). UI tada vidi "done" umesto da zapne.
        job_dir = RUNS_DIR / job_id
        csv_path = job_dir / "leads.csv"
        progress_path = job_dir / "progress.json"
        if not csv_path.exists():
            raise HTTPException(404, f"job {job_id} not found")
        rows = sum(1 for _ in csv.DictReader(csv_path.open()))
        status = "done" if rows > 0 else "empty"
        return {
            "jobId": job_id,
            "status": status,
            "query": None,
            "category": "",
            "city": "",
            "country": "RS",
            "maxResults": None,
            "extractEmails": False,
            "rowsWritten": rows,
            "elapsedSec": 0.0,
            "exitCode": 0,
            "error": None,
            "hasCsv": True,
            "stage": "done",
        }
    return _job_view(job)


@app.get("/scrape-leads/progress/{job_id}")
async def job_progress(job_id: str) -> dict[str, Any]:
    """Vraća poslednji progress event (stage, event, count, message)."""
    job = _JOBS.get(job_id)
    if not job:
        # Disk fallback za završene job-ove (posle restarta).
        job_dir = RUNS_DIR / job_id
        progress_path = job_dir / "progress.json"
        if not progress_path.exists():
            raise HTTPException(404, f"job {job_id} not found")
        try:
            snap = json.loads(progress_path.read_text(encoding="utf-8"))
        except Exception:
            snap = {}
        return {"jobId": job_id, "status": "done", "snapshot": snap}
    snap = _read_progress(job) or {}
    return {
        "jobId": job.job_id,
        "status": job.status,
        "snapshot": snap,
    }


@app.post("/scrape-leads/import/{job_id}")
async def import_results(job_id: str) -> dict[str, Any]:
    """Parse the finished CSV into row dicts the webapp can preview/import.

    Ako job više nije u _JOBS dict-u (npr. servis je restartovan posle scrape-a),
    pokušavamo da ga rekonstruišemo sa diska — CSV fajl je i dalje u RUNS_DIR.
    Ovo je bitno jer bez ovoga import endpoint vraća 404 iako CSV postoji.
    """
    job = _JOBS.get(job_id)
    if not job:
        # Disk fallback: pokušaj da pročitaš job iz CSV + progress.json na disku
        job_dir = RUNS_DIR / job_id
        csv_path = job_dir / "leads.csv"
        progress_path = job_dir / "progress.json"
        if not csv_path.exists():
            raise HTTPException(404, f"job {job_id} not found (no CSV on disk)")
        job = Job(
            job_id=job_id,
            status="done",
            csv_path=str(csv_path),
            progress_path=str(progress_path) if progress_path.exists() else None,
            finished_at=time.time(),
            rows_written=sum(1 for _ in csv.DictReader(csv_path.open())),
        )

    if job.status not in ("done", "empty"):
        raise HTTPException(409, f"job not finished — status={job.status}")
    if not job.csv_path or not Path(job.csv_path).exists():
        return {"rows": [], "count": 0, "columns": CSV_COLUMNS}

    with Path(job.csv_path).open() as f:
        rows = list(csv.DictReader(f))
    # Coerce numeric columns so the UI doesn't have to. Prazna CSV polja
    # postaju "" — eksplicitno ih pretvaramo u None da JSON pošalje null,
    # a ne "" (što bi puklo Zod number validator).
    for r in rows:
        for k in ("rating", "reviews_count", "latitude", "longitude"):
            v = r.get(k)
            if v is None or v == "":
                r[k] = None
                continue
            try:
                r[k] = float(v) if k != "reviews_count" else int(float(v))
            except (ValueError, TypeError):
                r[k] = None
        if r.get("hours_json"):
            try:
                r["hours_json"] = json.loads(r["hours_json"])
            except (ValueError, TypeError):
                r["hours_json"] = None
    return {"rows": rows, "count": len(rows), "columns": CSV_COLUMNS}


def main() -> None:
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8002"))
    uvicorn.run(app, host=host, port=port, log_level=os.environ.get("LOG_LEVEL", "info"))


__all__ = ["app", "main", "CSV_COLUMNS", "Job"]