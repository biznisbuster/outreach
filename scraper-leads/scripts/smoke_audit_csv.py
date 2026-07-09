"""End-to-end demo of the audit pipeline on a realistic leads CSV.

Run::

    uv run python scripts/smoke_audit_csv.py

Reads ``examples/sample_leads.csv`` (output of the maps scraper) and
runs the audit module against every row that has a website. Prints the
resulting rows with the appended ``site_*`` columns.
"""

from __future__ import annotations

import csv
import subprocess
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
SAMPLE = REPO / "examples" / "sample_leads.csv"
OUT = REPO / "examples" / "sample_leads_audited.csv"


def main() -> int:
    if not SAMPLE.exists():
        print(f"missing sample: {SAMPLE}", file=sys.stderr)
        return 1
    print(f"running audit on {SAMPLE}")
    print(f"output -> {OUT}\n")
    cmd = [
        sys.executable, "-m", "maps_cold_calling.audit",
        "--input", str(SAMPLE),
        "--output", str(OUT),
        "--concurrency", "4",
        "--quiet",
    ]
    res = subprocess.run(cmd, cwd=REPO)
    if res.returncode != 0:
        print(f"audit exited with {res.returncode}", file=sys.stderr)
        return res.returncode

    print("\n--- result ---\n")
    with OUT.open() as f:
        # Show only the most decision-relevant columns
        interesting = [
            "name",
            "website",
            "audit_status",
            "site_score",
            "site_grade",
            "site_verdict",
            "site_title",
            "site_has_blog",
            "site_estimated_pages",
            "site_tech_stack",
            "site_domain_age_years",
            "site_https",
            "site_http_status",
            "site_summary",
        ]
        for row in csv.DictReader(f):
            for col in interesting:
                val = row.get(col, "")
                if not val:
                    continue
                if col == "site_summary":
                    print(f"  ── summary: {val[:120]}")
                    continue
                print(f"  {col:<22} = {val}")
            print()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
