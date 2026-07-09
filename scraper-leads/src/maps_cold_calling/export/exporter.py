"""Exporter protocol — Phase 5.1.

A small unified interface so we can pick CSV / JSON / SQLite based on the
``--format`` flag without conditional logic in the runner.
"""

from __future__ import annotations

from typing import Iterable, Protocol

from maps_cold_calling.models import Business


class Exporter(Protocol):
    """Anything that can receive businesses and finalize an output."""

    def add(self, business: Business) -> None: ...
    def add_many(self, businesses: Iterable[Business]) -> None: ...
    def close(self) -> None: ...


__all__ = ["Exporter"]
