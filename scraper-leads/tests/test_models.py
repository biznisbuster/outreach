"""Tests for the Business dataclass model."""

from __future__ import annotations

import pytest

from maps_cold_calling.models import Business


def test_create_simple():
    b = Business(name="Test Salon")
    assert b.name == "Test Salon"
    assert b.country is None
    assert b.source == "maps"
    assert b.scraped_at


def test_rejects_empty_name():
    with pytest.raises(ValueError):
        Business(name="")
    with pytest.raises(ValueError):
        Business(name="   ")


def test_round_trip_dict():
    b = Business(
        name="Hairdresser",
        address="Some St 1",
        city="Kruševac",
        country="RS",
        phone_e164="+38137422232",
        website="https://example.com",
        email="x@example.com",
        rating=4.5,
        reviews_count=10,
        latitude=43.58,
        longitude=21.32,
        google_place_id="ChIJxyz",
        google_maps_url="https://maps.google.com/?cid=0",
        source="maps",
    )
    d = b.to_dict()
    again = Business.from_dict(d)
    assert again.name == b.name
    assert again.phone_e164 == b.phone_e164
    assert again.google_place_id == b.google_place_id


def test_from_dict_ignores_unknown_keys():
    b = Business.from_dict({
        "name": "X",
        "future_field_unknown_to_this_version": "garbage",
    })
    assert b.name == "X"


def test_csv_row_flattens():
    b = Business(name="Test", hours_json={"monday": "08:00–20:00", "tuesday": "08:00–20:00"})
    row = b.to_csv_row()
    assert row["name"] == "Test"
    assert "monday" in row["hours_json"]
    assert row["email"] == ""  # None -> empty string


def test_csv_columns_unique():
    assert len(Business.CSV_COLUMNS) == len(set(Business.CSV_COLUMNS))
