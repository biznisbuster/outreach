"""In-memory audit job state (single-process).

Svaki async audit dobija job_id; status endpoint čita iz ovog dict-a.
Kada se scraper servis restartuje, job-ovi se gube (single-process ograničenje,
dokumentovano u README). Za produkciju sa više worker-a treba externalizovati
u Redis/SQLite, ali za sada je dovoljno.

Faze audita (prati redom):
    0. Re-fetch HTML
    1. SEO + Tech detection
    2. Security headers
    3. Performance
    4. Content
    5. Mobile + Accessibility
    6. UI/Design (MiniMax vision)
"""
from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field


# Job-ovi se automatski brišu posle ovog TTL-a da in-memory dict ne raste
# bez ograničenja. Audit obično traje 30-90s, tako da 10 minuta je dovoljno
# da frontend polling završi posle uspešnog/greškastog audita. Ako korisnik
# napusti tab pre završetka, job se čuva do 10 min za retry/back-fill.
JOB_TTL_SEC = 600  # 10 minuta

# Koliko često pokretati cleanup (sekundi)
JOB_CLEANUP_INTERVAL_SEC = 60

PHASES = [
    "Re-fetch HTML",
    "SEO + Security + Tech",
    "Performance + Content",
    "Mobile + Accessibility",
    "UI/Design (MiniMax vision)",
]


@dataclass
class AuditJob:
    job_id: str
    lead_id: int
    status: str = "running"  # running | done | error
    current_phase: str = "init"
    phase_index: int = 0
    total_phases: int = len(PHASES)
    phase_message: str = ""
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    overall_rank: int | None = None
    audit_id: int | None = None


_jobs: dict[str, AuditJob] = {}
_lock = threading.Lock()


def create_audit_job(job_id: str, lead_id: int) -> AuditJob:
    job = AuditJob(job_id=job_id, lead_id=lead_id, current_phase=PHASES[0])
    with _lock:
        _jobs[job_id] = job
    return job


def get_audit_job(job_id: str) -> AuditJob | None:
    with _lock:
        return _jobs.get(job_id)


def update_audit_job(job_id: str, **fields) -> None:
    with _lock:
        job = _jobs.get(job_id)
        if job:
            for k, v in fields.items():
                setattr(job, k, v)


def audit_job_to_dict(job: AuditJob) -> dict:
    elapsed = round(time.time() - job.started_at, 1)
    return {
        "job_id": job.job_id,
        "lead_id": job.lead_id,
        "status": job.status,
        "current_phase": job.current_phase,
        "phase_index": job.phase_index,
        "total_phases": job.total_phases,
        "phase_message": job.phase_message,
        "elapsed_sec": elapsed,
        "error": job.error,
        "overall_rank": job.overall_rank,
        "audit_id": job.audit_id,
    }


# ---------------------------------------------------------------------------
# TTL cleanup — automatski briše završene/greškom završene job-ove posle TTL
# ---------------------------------------------------------------------------

def cleanup_expired_jobs(ttl_sec: int = JOB_TTL_SEC) -> int:
    """Obriši sve job-ove starije od ``ttl_sec`` sekundi. Vraća broj obrisanih.

    Poziva se iz ``start_cleanup_loop`` svakih ``JOB_CLEANUP_INTERVAL_SEC``.
    """
    cutoff = time.time() - ttl_sec
    removed = 0
    with _lock:
        stale = [
            jid for jid, job in _jobs.items()
            if (job.status in ("done", "error")
                and (job.finished_at or job.started_at) < cutoff)
        ]
        for jid in stale:
            _jobs.pop(jid, None)
            removed += 1
    if removed:
        print(f"[audit_jobs] cleanup: obrisano {removed} završenih job-ova starijih od {ttl_sec}s")
    return removed


def _cleanup_worker(stop_event: threading.Event) -> None:
    """Background thread: pokreće cleanup_periodično. Staje kad stop_event set-uje."""
    while not stop_event.is_set():
        try:
            cleanup_expired_jobs()
        except Exception as e:  # noqa: BLE001
            print(f"[audit_jobs] cleanup error: {e}", flush=True)
        # Čekaj (ali odgovori na stop odmah)
        if stop_event.wait(timeout=JOB_CLEANUP_INTERVAL_SEC):
            break


_stop_event: threading.Event | None = None
_cleanup_thread: threading.Thread | None = None


def start_cleanup_loop() -> None:
    """Jednom pokreni cleanup thread (idempotent — poziva se iz main.py startup)."""
    global _stop_event, _cleanup_thread
    if _cleanup_thread and _cleanup_thread.is_alive():
        return
    _stop_event = threading.Event()
    _cleanup_thread = threading.Thread(
        target=_cleanup_worker,
        args=(_stop_event,),
        name="audit-jobs-cleanup",
        daemon=True,
    )
    _cleanup_thread.start()
    print("[audit_jobs] cleanup loop pokrenut (TTL={}s, interval={}s)".format(
        JOB_TTL_SEC, JOB_CLEANUP_INTERVAL_SEC
    ))


def stop_cleanup_loop() -> None:
    """Zaustavi cleanup thread (testiranje ili graceful shutdown)."""
    global _stop_event, _cleanup_thread
    if _stop_event:
        _stop_event.set()
    if _cleanup_thread:
        _cleanup_thread.join(timeout=2)
        _cleanup_thread = None
    _stop_event = None


def job_count() -> int:
    """Za testiranje/dashboard — broj aktivnih + završenih job-ova u memoriji."""
    with _lock:
        return len(_jobs)