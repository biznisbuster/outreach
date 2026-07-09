"""CSV exporter.

Implements the contract that ``exporter.py`` (Phase 5.1) will formalize.
For now, ``CsvWriter`` is the only exporter.

The column order is locked by ``Business.CSV_COLUMNS`` so that downstream
imports (PlanPlus/cold-outreach system) have a stable schema.
"""

from __future__ import annotations

import csv
import logging
from pathlib import Path
from typing import Iterable

from maps_cold_calling.models import Business

LOG = logging.getLogger(__name__)


class CsvWriter:
    """Append-style CSV writer.

    Use::

        w = CsvWriter(Path("leads.csv"))
        for biz in businesses:
            w.add(biz)
        w.close()
    """

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = self.path.open("w", newline="", encoding="utf-8")
        self._writer = csv.DictWriter(
            self._fh,
            fieldnames=Business.CSV_COLUMNS,
            quoting=csv.QUOTE_MINIMAL,
            lineterminator="\n",
        )
        self._writer.writeheader()
        self._count = 0

    def add(self, business: Business) -> None:
        self._writer.writerow(business.to_csv_row())
        self._count += 1

    def add_many(self, businesses: Iterable[Business]) -> None:
        for b in businesses:
            self.add(b)

    def close(self) -> None:
        try:
            self._fh.flush()
        except Exception:  # noqa: BLE001
            pass
        try:
            self._fh.close()
        except Exception:  # noqa: BLE001
            pass
        LOG.info("csv: wrote %d rows → %s", self._count, self.path)

    def __enter__(self) -> "CsvWriter":
        return self

    def __exit__(self, *_exc: Any) -> None:
        self.close()


__all__ = ["CsvWriter"]
