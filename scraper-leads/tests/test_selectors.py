"""Tests for the Maps helpers in scraper/maps_detail.py (no network)."""

from __future__ import annotations

from maps_cold_calling.scraper.maps_detail import (
    _extract_lat_lng,
    _extract_place_id,
    _parse_int_from_text,
    _parse_reviews_label,
    _phone_digits_only,
    _rating_from_aria,
    _strip_address_label,
)


def test_extract_lat_lng_at_form():
    assert _extract_lat_lng("https://maps.google.com/@43.5846402,21.3247454,17z") == (43.5846402, 21.3247454)


def test_extract_lat_lng_data_blob_form():
    assert _extract_lat_lng("https://maps.google.com/?foo=!3d43.58!4d21.32") == (43.58, 21.32)


def test_extract_lat_lng_missing():
    assert _extract_lat_lng("https://example.com") == (None, None)


def test_extract_place_id():
    assert _extract_place_id("https://maps.google.com/place/foo/@43,21/!19sChIJzR1iIquHVkcRflU5Arb7m74") == "ChIJzR1iIquHVkcRflU5Arb7m74"


def test_extract_place_id_missing():
    assert _extract_place_id("https://example.com/no-id-here") is None


def test_phone_digits_only():
    assert _phone_digits_only("+381 37 422 232") == "+38137422232"
    assert _phone_digits_only("037/422-232") == "037422232"


def test_rating_from_aria():
    assert _rating_from_aria("4,7 stars") == 4.7
    assert _rating_from_aria("Rating: 5.0 out of 5") == 5.0
    assert _rating_from_aria("no rating here") is None


def test_parse_int_from_text():
    assert _parse_int_from_text("12 reviews") == 12
    assert _parse_int_from_text("(370)") == 370
    assert _parse_int_from_text("") is None
    assert _parse_int_from_text(None) is None


def test_strip_address_label_serbian_cyrillic():
    assert _strip_address_label("Адреса: Стевана Синђелића 5, Крушевац") == "Стевана Синђелића 5, Крушевац"


def test_strip_address_label_english():
    assert _strip_address_label("Address: 5 Some St, Krusevac") == "5 Some St, Krusevac"


def test_strip_address_label_no_prefix():
    assert _strip_address_label("Plain address") == "Plain address"


# ──────────────── reviews-label parser (2025+ Maps) ────────────────


def test_parse_reviews_label_cyrillic_only():
    # 2025+ Maps: dedicated reviews pill on the owner's panel.
    rating, reviews = _parse_reviews_label("1.911 рецензија")
    assert rating is None
    assert reviews == 1911


def test_parse_reviews_label_cyrillic_no_thousands_sep():
    rating, reviews = _parse_reviews_label("615 рецензија")
    assert rating is None
    assert reviews == 615


def test_parse_reviews_label_combined_cyrillic():
    # 2025+ Maps: combined label on neighbour cards.
    rating, reviews = _parse_reviews_label("Звездица: 4,5 Рецензија: 581")
    assert rating == 4.5
    assert reviews == 581


def test_parse_reviews_label_combined_cyrillic_thousands():
    rating, reviews = _parse_reviews_label("Звездица: 4,4 Рецензија: 1.589")
    assert rating == 4.4
    assert reviews == 1589


def test_parse_reviews_label_english():
    rating, reviews = _parse_reviews_label("Rating: 4.5 Reviews: 120")
    assert rating == 4.5
    assert reviews == 120


def test_parse_reviews_label_serbian_latin():
    rating, reviews = _parse_reviews_label("5,0 od 5 zvezdica 312 recenzija")
    assert rating == 5.0
    assert reviews == 312


def test_parse_reviews_label_empty():
    assert _parse_reviews_label("") == (None, None)
    assert _parse_reviews_label(None) == (None, None)


def test_parse_reviews_label_garbage():
    assert _parse_reviews_label("plain text") == (None, None)
