"""CLI parsing for maps_cold_calling.

Phase 1.1 stub: a minimal ``argparse`` with the full flag surface so future
implementation can be dropped in without touching the dispatch logic. The real
pipeline is wired in Phase 1.8.
"""

from __future__ import annotations

import argparse

from maps_cold_calling import runner


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="maps-cold-calling",
        description=(
            "Scrape Google Maps (and other sources) for (category, city) leads — "
            "name, address, phone, website, optional email — for cold outreach."
        ),
    )
    parser.add_argument("--query", default=None, help="Full search query (alternative to --category + --city). Ceo string ide kao Google Maps pretraga, npr. 'cvecare beograd'.")
    parser.add_argument("--category", required=False, help="Business category (e.g. 'frizerski salon')")
    parser.add_argument("--city", required=False, help="City name (e.g. 'Kruševac' or 'Krusevac')")
    parser.add_argument("--country", default="RS", help="ISO country code, default RS")
    parser.add_argument("--language", default="sr", help="BCP-47-ish language code, default 'sr'; falls back to 'en'")
    parser.add_argument("--max-results", type=int, default=None, help="Cap on number of businesses; default = scroll until exhausted")
    parser.add_argument("--source", choices=("maps", "planplus", "both"), default="maps", help="Data source(s)")
    parser.add_argument("--extract-emails", action="store_true", help="Opt-in: visit each business website to extract a contact email")
    parser.add_argument(
        "--stealth",
        choices=("off", "lite", "standard", "aggressive"),
        default="lite",
        help="Stealth tier (default: lite)",
    )
    parser.add_argument("--proxy", default=None, help="Proxy URL (or set MAPS_PROXY env var). Supports comma-separated rotation.")
    parser.add_argument("--headless", action="store_true", default=True, help="Run browser headless (default)")
    parser.add_argument("--headed", dest="headless", action="store_false", help="Run browser with UI")
    parser.add_argument("--output", default="leads.csv", help="Output file path (default: ./leads.csv)")
    parser.add_argument("--format", choices=("csv", "json", "sqlite"), default="csv", help="Output format (default: csv)")
    parser.add_argument("--on-captcha", choices=("stop", "skip"), default="skip", help="Behavior when captcha is detected (default: skip)")
    parser.add_argument("--dry-run", action="store_true", help="Scrape a few results and print summary instead of writing output")
    parser.add_argument("--resume", default=None, help="Path to a JSONL checkpoint file to resume from")
    # Progress monitoring (for webapp integration)
    parser.add_argument(
        "--progress-stdout", action="store_true",
        help="Emit one JSON progress event per line to stdout (for subprocess integration)",
    )
    parser.add_argument(
        "--progress-file", default=None,
        help="Write JSON progress snapshot to this file after every event (for polling integration)",
    )
    parser.add_argument("-v", "--verbose", action="store_true", help="DEBUG logging")
    parser.add_argument("-q", "--quiet", action="store_true", help="WARNING-only logging")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    args = parser.parse_args(argv)
    # Validacija: query ILI (category + city)
    if not args.query and not (args.category and args.city):
        parser.error("Potrebno je --query ILI (--category i --city)")
    return runner.main(args)


if __name__ == "__main__":
    raise SystemExit(main())
