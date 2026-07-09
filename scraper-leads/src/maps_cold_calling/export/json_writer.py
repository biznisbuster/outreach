"""JSON exporter — Phase 5.2."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Iterable

from maps_cold_calling.models import Business

LOG = logging.getLogger(__name__)


class JsonWriter:
    """Buffer businesses in memory and dump a single JSON array on close."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._rows: list[dict[str, Any]] = []

    def add(self, business: Business) -> None:
        self._rows.append(business.to_dict())

    def add_many(self, businesses: Iterable[Business]) -> None:
        for b in businesses:
            self.add(b)

    def close(self) -> None:
        with self.path.open("w", encoding="utf-8") as fh:
            json.dump(self._rows, fh, ensure_ascii=False, indent=2)
        LOG.info("json: wrote %d rows → %s", len(self._rows), self.path)

    def __enter__(self) -> "JsonWriter":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


__all__ = ["JsonWriter"]
