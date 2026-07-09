"""Entry point: ``python -m maps_cold_calling.audit``."""

from __future__ import annotations

from .cli import main

if __name__ == "__main__":
    raise SystemExit(main())
