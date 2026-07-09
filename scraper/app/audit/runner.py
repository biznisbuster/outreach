"""runner.py — orchestrator: load latest scrape, re-fetch, audit, persist.

Entry point: ``run_audit(lead_id) -> dict``.

Steps:
    1. Look up the most recent successful ``site_scrapes`` for the lead.
    2. Collect URLs from ``site_pages`` (capped at MAX_AUDIT_PAGES, default 25).
    3. Re-fetch HTML + headers for each URL.
    4. Enrich with structured text, headings, accessibility counters.
    5. Run all sub-audits.
    6. Combine via site_rank → overall_rank + verdict + categories.
    7. Persist to ``site_audits`` + ``site_audit_metrics`` tables.
    8. Return the full report dict.
"""
from __future__ import annotations

import json
import os
import time
from typing import Iterable
from urllib.parse import urlparse

from . import aggregate as ag
from . import traffic as traffic_module
from .site_rank import compute_overall, WEIGHTS


MAX_AUDIT_PAGES = int(os.environ.get("MAX_AUDIT_PAGES", "25"))
AUDIT_DELAY_SEC = float(os.environ.get("AUDIT_DELAY_SEC", "0.4"))


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def run_audit(lead_id: int, *, audit_id: int | None = None) -> dict:
    """Run a fresh audit on the lead's most recent successful scrape.

    ``audit_id`` is normally auto-generated; pass an integer to use a specific
    row id (only useful when writing test fixtures).
    Returns the full report dict (same shape persisted to DB).
    """
    from .. import db  # late import to avoid cycles

    lead = db.get_lead(lead_id)
    if not lead or not lead.get("website_normalized"):
        raise ValueError(f"lead {lead_id} not found or has no website")
    domain = lead["website_normalized"]
    base_url = f"https://{domain}"

    scrape = db.get_latest_successful_scrape(lead_id)
    if not scrape:
        raise ValueError(f"no successful scrape found for lead {lead_id}; run /scrape first")
    scrape_id = scrape["id"]

    urls = db.get_scrape_page_urls(scrape_id, limit=MAX_AUDIT_PAGES)
    if not urls:
        raise ValueError(f"scrape {scrape_id} has no pages")

    t0 = time.time()

    # 1) Re-fetch each URL (gives us current HTML, headers, page weight)
    raw_pages = ag.fetch_raw_pages(urls, delay_sec=AUDIT_DELAY_SEC)

    # 2) Enrich with parsed structure
    enriched_pages = ag.enrich_pages_with_extra(raw_pages)

    # 3) Traffic signals (Tranco + OpenPageRank)
    traffic_signals = traffic_module.traffic_signals(domain)

    # 4) Aggregate — runs all sub-audits
    signals = ag.aggregate(enriched_pages, base_url, traffic_signals)

    # 5) Compute overall rank via the weighted-sum scorer
    cat_scores = signals["category_scores"]
    overall_rank, ranked, verdict = compute_overall(cat_scores)

    # Attach per-category issue lists to the breakdown
    for cat in cat_scores:
        ranked[cat]["issues"] = signals["category_issues"].get(cat, [])

    duration_ms = int((time.time() - t0) * 1000)

    # Top issues — pick 8 across categories, sorted by category weight descending
    top_issues = _pick_top_issues(ranked)

    report = {
        "lead_id": lead_id,
        "domain": domain,
        "scrape_id": scrape_id,
        "scrape_meta": {
            "pages_discovered": scrape.get("total_pages_discovered"),
            "pages_scraped": scrape.get("pages_scraped"),
            "started_at": scrape.get("started_at"),
            "finished_at": scrape.get("finished_at"),
        },
        "overall_rank": overall_rank,
        "verdict": verdict["key"],
        "verdict_label": verdict["label"],
        "pitch_advice": verdict["advice"],
        "top_issues": top_issues,
        "categories": ranked,
        "metrics": signals["category_metrics"],
        "pages": signals["pages"],
        "duration_ms": duration_ms,
        "created_at": int(time.time() * 1000),
    }

    # 6) Persist
    audit_id = db.create_audit(report, audit_id=audit_id)
    db.create_audit_metrics(audit_id, ranked)
    report["audit_id"] = audit_id

    return report


# ---------------------------------------------------------------------------
# Top issues picker
# ---------------------------------------------------------------------------

def _pick_top_issues(ranked: dict, limit: int = 8) -> list[str]:
    """Return up to ``limit`` of the highest-impact issues to surface first."""
    # Order categories by descending weight — SEO + perf + content come first
    by_weight = sorted(ranked.items(), key=lambda kv: -kv[1]["weight"])
    picked: list[str] = []
    for cat, data in by_weight:
        for issue in data.get("issues", []):
            if issue and issue not in picked:
                picked.append(issue)
            if len(picked) >= limit:
                return picked
        if len(picked) >= limit:
            return picked
    return picked
