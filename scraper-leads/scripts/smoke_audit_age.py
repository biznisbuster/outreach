"""Smoke test for the WHOIS/RDAP age path — slower, opt-in.

Run via::

    uv run python scripts/smoke_audit_age.py
"""

from __future__ import annotations

import asyncio
import csv
import tempfile
from pathlib import Path

from maps_cold_calling.audit.pipeline import run_audit

CANDIDATES: list[dict[str, str]] = [
    {"name": "Google", "website": "https://www.google.com/"},
    {"name": "GitHub", "website": "https://github.com/"},
    {"name": "DrMax RS", "website": "https://www.drmax.rs/"},  # real .rs domain
]


def main() -> int:
    with tempfile.TemporaryDirectory() as td:
        in_path = Path(td) / "in.csv"
        out_path = Path(td) / "out.csv"
        with in_path.open("w", encoding="utf-8", newline="") as f:
            w = csv.DictWriter(f, fieldnames=["name", "website"])
            w.writeheader()
            for row in CANDIDATES:
                w.writerow(row)
        # DO NOT skip age — exercise the WHOIS/RDAP path.
        stats = run_audit(in_path, out_path, concurrency=2, per_host_max=2, skip_age=False)
        print(f"\nstats: {stats}\n")
        with out_path.open() as f:
            for row in csv.DictReader(f):
                domain = row.get("site_domain", "?")
                created = row.get("site_domain_created", "?")
                age = row.get("site_domain_age_years", "?")
                registrar = row.get("site_domain_registrar", "?")
                status = row.get("audit_status", "?")
                print(f"  - {row['name']:<14}  status={status:<8}  domain={domain:<25}  created={created}  age={age}y  registrar={registrar}")

    # At least 2 of the 3 should produce meaningful age data.
    meaningful = stats.get("audited", 0) + stats.get("partial", 0)
    print(f"\nsmoke: PASS ({meaningful}/3 meaningful)" if meaningful >= 2 else "\nsmoke: FAIL")
    return 0 if meaningful >= 2 else 1


if __name__ == "__main__":
    raise SystemExit(main())
