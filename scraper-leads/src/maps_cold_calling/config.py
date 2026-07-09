"""Typed configuration: from parsed CLI args + env vars to a ``RunConfig``."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from maps_cold_calling.progress import ProgressCallback


@dataclass
class RunConfig:
    """Resolved runtime config.

    Built in ``runner.main()`` from ``argparse.Namespace`` + env vars.
    """

    category: str
    city: str
    country: str
    language: str
    source: str
    extract_emails: bool
    stealth_tier: str
    proxy: str | None
    headless: bool
    output_path: Path
    output_format: str
    on_captcha: str
    max_results: int | None
    dry_run: bool
    resume_path: Path | None
    verbose: bool
    quiet: bool

    # ── progress monitoring (Phase: see progress.py) ──
    # 1) In-process callback (in-process integration)
    on_progress: Any = None
    # 2) JSON-lines to stdout (subprocess integration)
    progress_stdout: bool = False
    # 3) JSON snapshot to a file (polling integration)
    progress_file: Path | None = None


__all__ = ["RunConfig"]
