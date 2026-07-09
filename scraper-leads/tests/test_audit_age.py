"""Tests for the apex-domain fuzzer used by the WHOIS lookup."""

from __future__ import annotations

from maps_cold_calling.audit.whois_age import _to_apex


def test_apex_strips_www():
    assert _to_apex("www.example.com") == "example.com"


def test_apex_keeps_two_label():
    assert _to_apex("example.com") == "example.com"


def test_apex_for_co_uk_keeps_three_labels():
    assert _to_apex("www.example.co.uk") == "example.co.uk"
    assert _to_apex("a.b.example.co.uk") == "example.co.uk"


def test_apex_for_co_rs():
    assert _to_apex("www.drmax.co.rs") == "drmax.co.rs"
    assert _to_apex("shop.drmax.co.rs") == "drmax.co.rs"


def test_apex_strips_trailing_dot():
    assert _to_apex("example.com.") == "example.com"


def test_apex_lowercases():
    assert _to_apex("WWW.Example.COM") == "example.com"


def test_apex_handles_unknown_tld_as_two_label():
    assert _to_apex("foo.bar.example.xyz") == "example.xyz"
