"""JSONL checkpoint/resume support.

Phase 2.4 — write each successfully-extracted business as one JSON line. On
resume, ``ResumeReader`` yields the set of place_ids we've already scraped so
the runner can skip them.
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterator

from maps_cold_calling.models import Business

LOG = logging.getLogger(__name__)


class JsonlCheckpoint:
    """Append-only writer for one JSON object per line."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        # Open in append mode so existing checkpoint files are preserved.
        self._fh = self.path.open("a", encoding="utf-8")

    def append(self, business: Business) -> None:
        line = json.dumps(business.to_dict(), ensure_ascii=False)
        self._fh.write(line + "\n")
        self._fh.flush()

    def close(self) -> None:
        try:
            self._fh.close()
        except Exception:  # noqa: BLE001
            pass


class ResumeReader:
    """Read a checkpoint and yield its place_ids so the runner can skip them."""

    def __init__(self, path: Path | str) -> None:
        self.path = Path(path)
        self.seen_place_ids: set[str] = set()
        self.businesses: list[Business] = []
        if not self.path.exists():
            return
        for line in self.path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                data = json.loads(line)
            except json.JSONDecodeError:
                LOG.warning("checkpoint: skipping unparseable line in %s", self.path)
                continue
            biz = Business.from_dict(data)
            self.businesses.append(biz)
            if biz.google_place_id:
                self.seen_place_ids.add(biz.google_place_id)


__all__ = ["JsonlCheckpoint", "ResumeReader"]
