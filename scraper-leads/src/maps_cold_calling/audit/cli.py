"""CLI for the website audit module.

Usage::

    python -m maps_cold_calling.audit --input leads.csv --output leads-audited.csv

Audits every row that has a ``website`` (or any URL-like) column. Output
is a new CSV with the same columns plus ``site_score``, ``site_grade``,
``site_verdict``, ``site_pros``, ``site_cons``, ``site_summary`` etc.
"""

from __future__ import annotations

import argparse
import logging
import sys

from . import pipeline


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="maps-cold-calling.audit",
        description=(
            "Audit every website in a leads CSV — SEO, content, design, "
            "blog, page count, tech stack, domain age. Outputs an enriched "
            "CSV with a CALL / MAYBE / SKIP verdict per row."
        ),
    )
    parser.add_argument(
        "--input", required=True,
        help="Input CSV path (output of maps-cold-calling)",
    )
    parser.add_argument(
        "--output", required=True,
        help="Output CSV path — augmented with site_* columns",
    )
    parser.add_argument(
        "--concurrency", type=int, default=4,
        help="Max concurrent site audits (default: 4)",
    )
    parser.add_argument(
        "--per-host", type=int, default=2,
        help="Max concurrent requests per host (default: 2)",
    )
    parser.add_argument(
        "--skip-age", action="store_true",
        help="Skip WHOIS/RDAP lookups (faster)",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true", help="DEBUG logging",
    )
    parser.add_argument(
        "-q", "--quiet", action="store_true", help="WARNING-only logging",
    )
    return parser


def _configure_logging(args: argparse.Namespace) -> None:
    if args.quiet:
        level = logging.WARNING
    elif args.verbose:
        level = logging.DEBUG
    else:
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    _configure_logging(args)
    return pipeline.main(args)


if __name__ == "__main__":
    raise SystemExit(main())
