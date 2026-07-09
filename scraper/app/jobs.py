"""In-memory job state za scraping (single-proces)."""
import threading
import time
from dataclasses import dataclass, field


@dataclass
class Job:
    job_id: str
    lead_id: int
    status: str = "running"  # running|done|error
    total_pages: int = 0
    pages_scraped: int = 0
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None
    error: str | None = None
    pages: list = field(default_factory=list)
    screenshot: str | None = None
    domain: str | None = None


_jobs: dict[str, Job] = {}
_lock = threading.Lock()


def create_job(job_id: str, lead_id: int) -> Job:
    job = Job(job_id=job_id, lead_id=lead_id)
    with _lock:
        _jobs[job_id] = job
    return job


def get_job(job_id: str) -> Job | None:
    with _lock:
        return _jobs.get(job_id)


def update_job(job_id: str, **fields):
    with _lock:
        job = _jobs.get(job_id)
        if job:
            for k, v in fields.items():
                setattr(job, k, v)


def job_to_dict(job: Job) -> dict:
    return {
        "job_id": job.job_id,
        "lead_id": job.lead_id,
        "status": job.status,
        "total_pages": job.total_pages,
        "pages_scraped": job.pages_scraped,
        "domain": job.domain,
        "screenshot": job.screenshot,
        "error": job.error,
        "elapsed_sec": round(time.time() - job.started_at, 1),
    }
