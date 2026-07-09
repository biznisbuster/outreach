"""Domain models for the website audit pipeline.

A :class:`SiteAudit` row holds everything the audit discovered about one
business's website. The CSV writer flattens the dataclass and preserves the
existing columns of the input CSV while appending the ``site_*`` fields.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


CSV_COLUMNS: tuple[str, ...] = (
    # meta
    "audit_status",          # ok | partial | failed | skipped
    "audit_error",
    "audit_run_at",
    # url & transport
    "site_url",
    "site_http_status",
    "site_response_ms",
    "site_https",
    "site_redirects",
    "site_page_bytes",
    "site_gzip",
    # SEO
    "site_title",
    "site_meta_description",
    "site_h1",
    "site_h2_count",
    "site_canonical",
    "site_lang",
    "site_og_title",
    "site_og_description",
    # content
    "site_word_count",
    "site_image_count",
    "site_image_alt_coverage",
    # discovery
    "site_has_robots",
    "site_has_sitemap",
    "site_internal_links",
    "site_external_links",
    "site_estimated_pages",
    "site_has_blog",
    "site_blog_url",
    # tech / design
    "site_mobile_viewport",
    "site_tech_stack",
    # domain age
    "site_domain",
    "site_domain_created",
    "site_domain_age_years",
    "site_domain_registrar",
    # verdict
    "site_score",
    "site_grade",
    "site_verdict",
    "site_pros",
    "site_cons",
    "site_summary",
)


@dataclass
class SiteAudit:
    """The audit result for a single website."""

    audit_status: str = "skipped"
    audit_error: str | None = None
    audit_run_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    # URL & transport
    site_url: str | None = None
    site_http_status: int | None = None
    site_response_ms: int | None = None
    site_https: bool | None = None
    site_redirects: int | None = None
    site_page_bytes: int | None = None
    site_gzip: bool | None = None

    # SEO
    site_title: str | None = None
    site_meta_description: str | None = None
    site_h1: str | None = None
    site_h2_count: int | None = None
    site_canonical: str | None = None
    site_lang: str | None = None
    site_og_title: str | None = None
    site_og_description: str | None = None

    # Content
    site_word_count: int | None = None
    site_image_count: int | None = None
    site_image_alt_coverage: float | None = None

    # Discovery
    site_has_robots: bool | None = None
    site_has_sitemap: bool | None = None
    site_internal_links: int | None = None
    site_external_links: int | None = None
    site_estimated_pages: int | None = None
    site_has_blog: bool | None = None
    site_blog_url: str | None = None

    # Tech / design
    site_mobile_viewport: bool | None = None
    site_tech_stack: list[str] | None = None

    # Domain age
    site_domain: str | None = None
    site_domain_created: str | None = None
    site_domain_age_years: float | None = None
    site_domain_registrar: str | None = None

    # Verdict
    site_score: int | None = None
    site_grade: str | None = None
    site_verdict: str | None = None
    site_pros: list[str] | None = None
    site_cons: list[str] | None = None
    site_summary: str | None = None

    def to_csv_row(self) -> dict[str, str]:
        """Flatten for CSV — JSON-encodes lists / dicts / floats."""
        d = asdict(self)
        out: dict[str, str] = {}
        for k, v in d.items():
            if v is None:
                out[k] = ""
            elif isinstance(v, (list, dict)):
                out[k] = json.dumps(v, ensure_ascii=False)
            elif isinstance(v, bool):
                out[k] = "true" if v else "false"
            elif isinstance(v, float):
                out[k] = f"{v:.4f}".rstrip("0").rstrip(".") if v != int(v) else str(int(v))
            else:
                out[k] = str(v)
        return out


__all__ = ["SiteAudit", "CSV_COLUMNS"]
