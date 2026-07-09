"""Smoke test for the website audit pipeline.

Run via::

    uv run python scripts/smoke_audit.py

Audits a handful of known-good sites that are very likely to be up and
prints the resulting audit rows. Used as a CI smoke for Phase 8.

Sites chosen:
    - python.org       (canonical, well-SEO'd reference site → should score high, SKIP)
    - example.com      (minimal placeholder → mid score)
    - wix.com/about    (Wix-hosted → tech detection works)
    - wordpress.com    (WordPress detection works)
"""

from __future__ import annotations

import asyncio
import csv
import sys
import tempfile
from pathlib import Path

from maps_cold_calling.audit.pipeline import run_audit

CANDIDATES: list[dict[str, str]] = [
    {"name": "Python Org", "website": "https://www.python.org/"},
    {"name": "Example", "website": "https://example.com/"},
    {"name": "Wix About", "website": "https://www.wix.com/about"},
    {"name": "WordPress", "website": "https://wordpress.com/"},
    {"name": "Invalid Host Smoke", "website": "https://nonesuch-host-audit-smoke-12345.invalid/"},
]


def main() -> int:
    """Build a CSV, run the audit, print verdicts, return exit status."""
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "in.csv"
        out_path = Path(td) / "out.csv"

        with in_path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["name", "website"])
            w.writeheader()
            for row in CANDIDATES:
                w.writerow(row)

        # Use --skip-age for speed (WHOIS is the slowest step in normal use).
        stats = run_audit(
            in_path,
            out_path,
            concurrency=4,
            per_host_max=2,
            skip_age=True,
        )

        print(f"\nstats: {stats}\n")
        with out_path.open() as f:
            for row in csv.DictReader(f):
                verdict = row.get("site_verdict", "?")
                grade = row.get("site_grade", "?")
                score = row.get("site_score", "?")
                tech = row.get("site_tech_stack", "")
                blog = row.get("site_has_blog", "false")
                title = (row.get("site_title") or "")[:50]
                summary = row.get("site_summary") or ""
                err = row.get("audit_error", "")
                print(
                    f"  - {row['name']:<30}  score={score:>3}  grade={grade}  "
                    f"verdict={verdict:<5}  blog={blog}  tech={tech[:40]:<40}  "
                    f"title={title!r}"
                )
                if summary:
                    print(f"      └─ {summary[:200]}")
                if err:
                    print(f"      (note: {err[:140]})")

        ok = stats.get("audited", 0) >= 3 and stats.get("input_rows", 0) == len(CANDIDATES)
        print("\nsmoke: PASS" if ok else "\nsmoke: FAIL")
        return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
