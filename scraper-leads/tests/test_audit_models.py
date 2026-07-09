"""Tests for the SiteAudit dataclass model."""

from __future__ import annotations

from maps_cold_calling.audit.models import CSV_COLUMNS, SiteAudit


def test_site_audit_defaults():
    a = SiteAudit()
    assert a.audit_status == "skipped"
    assert a.audit_error is None
    assert a.site_score is None
    assert a.site_verdict is None
    assert a.site_tech_stack is None
    assert isinstance(a.audit_run_at, str) and len(a.audit_run_at) > 10


def test_to_csv_row_truthy_strings():
    import json as _json
    a = SiteAudit(
        audit_status="ok",
        site_url="https://example.com",
        site_http_status=200,
        site_score=87,
        site_grade="B",
        site_verdict="MAYBE",
        site_pros=["fast", "https"],
        site_cons=["no blog"],
    )
    row = a.to_csv_row()
    assert row["audit_status"] == "ok"
    assert row["site_url"] == "https://example.com"
    assert row["site_http_status"] == "200"
    assert row["site_score"] == "87"
    # lists serialize as a JSON string; round-trip via json.loads to be robust
    parsed = _json.loads(row["site_pros"])
    assert "fast" in parsed and "no blog" not in parsed
    assert _json.loads(row["site_cons"]) == ["no blog"]


def test_to_csv_row_none_becomes_empty_string():
    a = SiteAudit()
    row = a.to_csv_row()
    for col in CSV_COLUMNS:
        # every key must be present even if empty
        assert col in row
    assert row["site_url"] == ""
    assert row["site_score"] == ""


def test_csv_columns_unique():
    assert len(CSV_COLUMNS) == len(set(CSV_COLUMNS))
