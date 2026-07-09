"""CSV-in / CSV-out pipeline for the audit module.

Reads any CSV (output of ``maps_cold_calling``) and augments each row that
has a non-empty ``website`` value with a :class:`SiteAudit` result.

Concurrency is bounded by ``--concurrency`` so a 1,000-row CSV doesn't
open 1,000 simultaneous connections. Per-host politeness is handled inside
the HTTP client.

Output CSV preserves the **exact** original columns of the input and
appends the :data:`SiteAudit.CSV_COLUMNS` ``site_*`` fields at the end.
Rows whose ``website`` is empty are passed through untouched (audit_status
= ``skipped``).
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import logging
import re
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Iterable, Iterator

from .http_client import AuditHttp
from .models import CSV_COLUMNS, SiteAudit
from .site_audit import audit_one

LOG = logging.getLogger(__name__)

# Columns the audit will look for in the input CSV (case-insensitive).
# First match wins; missing columns just mean those businesses are treated
# as not-audit-candidate.
URL_COLUMN_CANDIDATES: tuple[str, ...] = (
    "website", "url", "site", "homepage", "web", "link",
)
NAME_COLUMN_CANDIDATES: tuple[str, ...] = (
    "name", "business", "title", "company",
)


def _detect_column(headers: list[str], candidates: tuple[str, ...]) -> str | None:
    low = {h.lower().strip(): h for h in headers}
    for c in candidates:
        if c.lower() in low:
            return low[c.lower()]
    return None


def _looks_like_url(value: str) -> str | None:
    """Strip whitespace, return value if it looks like a URL we can audit."""
    if not value:
        return None
    v = value.strip()
    if not v:
        return None
    if v.lower().startswith(("http://", "https://")):
        return v
    bare = re.match(r"^[\w\-]+(\.[\w\-]+)+(/.*)?$", v)
    if bare:
        return "https://" + v
    return None


def _read_csv_rows(path: Path) -> Iterator[dict[str, str]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            return
        for row in reader:
            yield {k: (v or "") for k, v in row.items()}


def _classify_audit_row(row: dict[str, str], url_col: str | None) -> tuple[str, str | None]:
    """Return ``(kind, url)`` where ``kind in ('audit','skip','passthrough')``."""
    if not url_col:
        return ("passthrough", None)
    raw = row.get(url_col, "")
    url = _looks_like_url(raw)
    if not url:
        return ("skip", None)
    # Skip social networks (no point auditing FB/IG profile pages). We are
    # intentionally conservative here — a subdomain like
    # ``salon.wixsite.com`` is left in (free-tier sites are good leads).
    parsed = re.match(r"^https?://([^/]+)/?", url, re.IGNORECASE)
    if parsed:
        host = parsed.group(1).lower()
        if host in {
            "facebook.com", "www.facebook.com", "m.facebook.com",
            "instagram.com", "www.instagram.com",
            "linkedin.com", "www.linkedin.com",
            "twitter.com", "www.twitter.com", "x.com", "www.x.com",
            "tiktok.com", "www.tiktok.com",
            "youtube.com", "www.youtube.com", "youtu.be",
            "google.com", "www.google.com", "maps.google.com",
            "goo.gl", "bit.ly", "tinyurl.com",
        }:
            return ("skip", url)
    return ("audit", url)


def _empty_audit(status: str = "skipped", error: str | None = None) -> dict[str, str]:
    a = SiteAudit(audit_status=status, audit_error=error)
    return a.to_csv_row()


async def _audit_rows(
    rows: list[tuple[int, dict[str, str], str]],
    *,
    concurrency: int,
    skip_age: bool,
    per_host_max: int,
) -> list[tuple[int, dict[str, str]]]:
    """Audit each ``(idx, row, url)`` concurrently.

    Returns a list of ``(idx, audit_row)`` preserving input order.
    """
    http = AuditHttp(max_concurrency_per_host=per_host_max)
    sem = asyncio.Semaphore(concurrency)
    try:
        results: list[tuple[int, dict[str, str]]] = []
        pending: list[asyncio.Task] = []

        async def one(idx: int, row: dict[str, str], url: str) -> tuple[int, dict[str, str]]:
            async with sem:
                aud = await audit_one(url, http=http, skip_age=skip_age)
            return (idx, aud.to_csv_row())

        for idx, row, url in rows:
            pending.append(asyncio.create_task(one(idx, row, url)))

        for fut in asyncio.as_completed(pending):
            try:
                results.append(await fut)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("audit: task failed: %s", exc)

        # Sort by original index so output preserves input order.
        results.sort(key=lambda r: r[0])
        return results
    finally:
        await http.close()


def run_audit(
    input_path: Path,
    output_path: Path,
    *,
    concurrency: int = 4,
    per_host_max: int = 2,
    skip_age: bool = False,
) -> dict[str, int]:
    """Top-level sync wrapper. Returns a small stats dict."""
    rows_iter = _read_csv_rows(input_path)
    try:
        first_batch = [next(rows_iter) for _ in range(1)]
    except StopIteration:
        LOG.error("empty CSV")
        return {"input_rows": 0, "audited": 0, "skipped": 0, "failed": 0}

    # We need the headers. Re-open the file to get them once.
    with input_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        headers = list(reader.fieldnames or [])

    url_col = _detect_column(headers, URL_COLUMN_CANDIDATES)
    LOG.info("pipeline: input=%s output=%s website_col=%s rows=%d",
             input_path, output_path, url_col, sum(1 for _ in _read_csv_rows(input_path)))

    audit_jobs: list[tuple[int, dict[str, str], str]] = []
    audited_indices: dict[int, dict[str, str]] = {}

    # First pass: classify every row; collect audit jobs.
    all_rows = list(_read_csv_rows(input_path))

    for idx, row in enumerate(all_rows):
        kind, url = _classify_audit_row(row, url_col)
        if kind == "audit":
            assert url is not None
            audit_jobs.append((idx, row, url))
        elif kind == "skip":
            audited_indices[idx] = _empty_audit(status="skipped", error="not a website (social/etc.)")
        else:
            audited_indices[idx] = _empty_audit(status="skipped", error="no website column")

    # Run audits.
    if audit_jobs:
        LOG.info("pipeline: auditing %d sites (concurrency=%d, skip_age=%s)",
                 len(audit_jobs), concurrency, skip_age)
        results = asyncio.run(
            _audit_rows(
                audit_jobs,
                concurrency=concurrency,
                skip_age=skip_age,
                per_host_max=per_host_max,
            )
        )
        for idx, ar in results:
            audited_indices[idx] = ar

    # Fill any remaining indices with skipped
    for idx in range(len(all_rows)):
        audited_indices.setdefault(idx, _empty_audit("skipped", "not audited"))

    # Write output preserving input column order + appended site_* columns.
    out_headers = list(headers)
    for col in CSV_COLUMNS:
        if col not in out_headers:
            out_headers.append(col)

    stats = {"audited": 0, "partial": 0, "skipped": 0, "failed": 0, "input_rows": len(all_rows)}
    with output_path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=out_headers, extrasaction="ignore")
        writer.writeheader()
        for idx, row in enumerate(all_rows):
            audit_row = audited_indices[idx]
            combined = {**row, **audit_row}
            writer.writerow(combined)
            status = audit_row.get("audit_status", "skipped")
            if status == "ok":
                stats["audited"] += 1
            elif status == "partial":
                stats["partial"] += 1
            elif status == "failed":
                stats["failed"] += 1
            else:
                stats["skipped"] += 1
    return stats


def main(args: argparse.Namespace) -> int:
    stats = run_audit(
        Path(args.input),
        Path(args.output),
        concurrency=args.concurrency,
        per_host_max=args.per_host,
        skip_age=args.skip_age,
    )
    LOG.info(
        "audit: done — %d rows in, %d audited, %d skipped, %d failed → %s",
        stats["input_rows"], stats["audited"], stats["skipped"], stats["failed"], args.output,
    )
    return 0


__all__ = ["run_audit", "main"]
