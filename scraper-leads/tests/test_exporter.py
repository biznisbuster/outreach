"""Tests for the CSV/JSON export pipeline (round-trip, no network)."""

from __future__ import annotations

import csv
import json
from pathlib import Path

from maps_cold_calling.export.csv_writer import CsvWriter
from maps_cold_calling.export.json_writer import JsonWriter
from maps_cold_calling.models import Business


def _biz(name: str) -> Business:
    return Business(name=name, phone_e164="+381641727770", website="https://example.com")


def test_csv_writer_round_trip(tmp_path: Path):
    p = tmp_path / "leads.csv"
    with CsvWriter(p) as w:
        w.add(_biz("Foo"))
        w.add(_biz("Bar"))
    with p.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 2
    assert rows[0]["name"] == "Foo"
    assert rows[0]["phone_e164"] == "+381641727770"
    assert rows[1]["name"] == "Bar"


def test_json_writer_round_trip(tmp_path: Path):
    p = tmp_path / "leads.json"
    with JsonWriter(p) as w:
        w.add(_biz("Foo"))
        w.add(_biz("Bar"))
    data = json.loads(p.read_text())
    assert isinstance(data, list)
    assert len(data) == 2
    assert data[0]["name"] == "Foo"


def test_csv_writer_add_many(tmp_path: Path):
    p = tmp_path / "leads.csv"
    with CsvWriter(p) as w:
        w.add_many([_biz(f"Biz{i}") for i in range(5)])
    with p.open() as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 5
