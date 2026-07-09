"""Tests for Serbian phone E.164 normalization."""

from __future__ import annotations

from maps_cold_calling.utils.phone import normalize


def test_landline_dashed():
    assert normalize("037/422-232", default_region="RS") == "+38137422232"


def test_mobile_no_separator():
    assert normalize("0641727770", default_region="RS") == "+381641727770"


def test_already_international():
    assert normalize("+381641727770", default_region="RS") == "+381641727770"


def test_garbage_returns_none():
    assert normalize("not a phone", default_region="RS") is None
    assert normalize("", default_region="RS") is None
    assert normalize(None, default_region="RS") is None


def test_too_short_returns_none():
    assert normalize("12345", default_region="RS") is None


def test_uses_default_region_for_local_numbers():
    # Brazilian-style local number with RS as default — should still try.
    # We just verify it doesn't crash.
    result = normalize("11 5555 5555", default_region="US")
    assert result is None or result.startswith("+1")
