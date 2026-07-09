"""Scraper servis — FastAPI app.
POST /scrape          → pokreće job za lead_id, vraća job_id
GET  /scrape/status/{job_id} → progres
GET  /health
POST /scrape/bulk     → lista lead_id-jeva (paralelno, worker pool)
"""
import os
import time
import uuid

from fastapi import FastAPI, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from . import db
from .sitemap_parser import find_sitemap, parse_sitemap
from .page_scraper import scrape_page
from .categorize import filter_pages
from .screenshot import capture_screenshot, _default_screenshots_dir
from .jobs import create_job, get_job, update_job, job_to_dict
from .audit import runner as audit_runner

MAX_PAGES = int(os.environ.get("MAX_PAGES_PER_LEAD", "30"))
SCREENSHOTS_DIR = os.environ.get("SCREENSHOTS_DIR") or _default_screenshots_dir()
DELAY_SEC = float(os.environ.get("SCRAPE_DELAY_SEC", "1.0"))
SCREENSHOT_PRE_WAIT_MS = int(os.environ.get("SCREENSHOT_PRE_WAIT_MS", "5000"))

app = FastAPI(title="Outreach Scraper", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ScrapeReq(BaseModel):
    lead_id: int
    max_pages: int | None = None


class BulkScrapeReq(BaseModel):
    lead_ids: list[int]
    max_pages: int | None = None


@app.get("/health")
async def health():
    return {"status": "ok", "service": "scraper"}


@app.post("/scrape")
async def scrape(req: ScrapeReq, bg: BackgroundTasks):
    lead = db.get_lead(req.lead_id)
    if not lead:
        return {"error": "lead not found"}, 404
    if not lead.get("website_normalized"):
        return {"error": "lead nema website"}, 400

    job_id = str(uuid.uuid4())
    create_job(job_id, req.lead_id)
    bg.add_task(run_scrape_job, job_id, req.lead_id, req.max_pages or MAX_PAGES)
    return {"job_id": job_id, "lead_id": req.lead_id, "status": "running"}


@app.post("/scrape/bulk")
async def scrape_bulk(req: BulkScrapeReq, bg: BackgroundTasks):
    job_ids = []
    for lid in req.lead_ids:
        lead = db.get_lead(lid)
        if not lead or not lead.get("website_normalized"):
            continue
        job_id = str(uuid.uuid4())
        create_job(job_id, lid)
        bg.add_task(run_scrape_job, job_id, lid, req.max_pages or MAX_PAGES)
        job_ids.append(job_id)
    return {"job_ids": job_ids, "count": len(job_ids)}


@app.get("/scrape/status/{job_id}")
async def scrape_status(job_id: str):
    job = get_job(job_id)
    if not job:
        return {"error": "job not found"}, 404
    return job_to_dict(job)


def run_scrape_job(job_id: str, lead_id: int, max_pages: int):
    """Glavna scrape logika — radi u pozadini."""
    update_job(job_id, status="running")
    lead = db.get_lead(lead_id)
    if not lead or not lead.get("website_normalized"):
        update_job(job_id, status="error", error="lead nema website", finished_at=time.time())
        return

    domain = lead["website_normalized"]
    base_url = f"https://{domain}"
    update_job(job_id, domain=domain)

    # 1) nađi sitemap
    sitemap_url = find_sitemap(base_url)
    page_urls: list[str] = []
    if sitemap_url:
        page_urls = parse_sitemap(sitemap_url, max_depth=5)

    # ako sitemap ne postoji ili je prazan → crawl homepage (jedna stranica)
    if not page_urls:
        page_urls = [base_url]

    page_urls = filter_pages(page_urls, max_pages)
    # uvek garantuj da je homepage prvi
    if base_url in page_urls:
        page_urls.remove(base_url)
    page_urls.insert(0, base_url)
    page_urls = page_urls[:max_pages]

    update_job(job_id, total_pages=len(page_urls))

    # 2) kreiraj scrape zapis
    scrape_id = db.create_scrape(lead_id, domain, sitemap_url)
    pages_data: list[dict] = []

    for url in page_urls:
        page = scrape_page(url, timeout=20.0)
        if page:
            db.insert_page(scrape_id, page)
            pages_data.append(page)
        time.sleep(DELAY_SEC)
        update_job(job_id, pages_scraped=len(pages_data))

    # 3) screenshot
    screenshot_path = None
    try:
        screenshot_path = capture_screenshot(base_url, lead_id, SCREENSHOTS_DIR, pre_wait_ms=SCREENSHOT_PRE_WAIT_MS)
        if screenshot_path:
            db.insert_screenshot(lead_id, screenshot_path)
    except Exception as e:
        print(f"[scrape] screenshot greška: {e}")

    # 4) završi scrape zapis
    import time as _t
    db.update_scrape(
        scrape_id,
        status="done",
        total_pages_discovered=len(page_urls),
        pages_scraped=len(pages_data),
        finished_at=int(_t.time() * 1000),
    )

    update_job(
        job_id,
        status="done",
        pages_scraped=len(pages_data),
        screenshot=screenshot_path,
        finished_at=time.time(),
        pages=pages_data,
    )
    print(f"[scrape] job {job_id} gotov: {len(pages_data)} strana, screenshot={bool(screenshot_path)}")

    # 5) automatski audit — pokreni posle uspešnog scrape-a.
    # Site audit koristi poslednji uspešan scrape da izračuna multi-criteria
    # 0-100 ranking sajta. Može da traje 30-90s (re-fetch svake stranice).
    if len(pages_data) > 0:
        try:
            print(f"[scrape] pokrećem automatski audit za lead_id={lead_id}...")
            audit_report = audit_runner.run_audit(lead_id)
            # audit_report dict sadrži 'overall_rank' (0-100), ne 'score'
            rank = audit_report.get('overall_rank', audit_report.get('score', 'n/a'))
            print(f"[scrape] audit završen: rank={rank}")
        except Exception as e:
            # Audit ne treba da blokira scrape — samo loguj
            print(f"[scrape] audit greška (nije fatalno): {e}")
            import traceback
            traceback.print_exc()
    else:
        print(f"[scrape] nema scraped strana, preskačem audit")


@app.get("/")
async def root():
    return {"service": "outreach-scraper", "endpoints": ["/health", "/scrape", "/scrape/bulk", "/scrape/status/{job_id}", "/audit/{lead_id}", "/audit/{lead_id}/latest", "/audit/by-id/{audit_id}"]}


# ============================================================================
# Site audit endpoints — POST /audit/{lead_id}, GET /audit/{lead_id}/latest,
#                          GET /audit/by-id/{audit_id}
#
# The audit consumes the most-recent successful site_scrapes row for the lead
# and re-fetches each URL to produce a multi-criteria 0-100 site ranking.
# ============================================================================

@app.post("/audit/{lead_id}")
async def audit_site(lead_id: int, bg: BackgroundTasks):
    """Re-fetch and audit the lead's website synchronously (or in background if you really must).

    Returns 503 if no successful scrape exists yet — client should call
    /scrape first.
    """
    try:
        report = audit_runner.run_audit(lead_id)
    except ValueError as e:
        return {"error": str(e)}, 404
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"error": f"audit failed: {e}"}, 500
    return report


@app.get("/audit/{lead_id}/latest")
async def audit_latest(lead_id: int):
    """Return the most recent stored audit for a lead."""
    r = db.get_latest_audit_for_lead(lead_id)
    if not r:
        return {"error": "no audit found for this lead; POST /audit/{lead_id} first"}, 404
    return r


@app.get("/audit/by-id/{audit_id}")
async def audit_by_id(audit_id: int):
    """Return an audit by its row id."""
    r = db.get_audit_by_id(audit_id)
    if not r:
        return {"error": "audit not found"}, 404
    return r
