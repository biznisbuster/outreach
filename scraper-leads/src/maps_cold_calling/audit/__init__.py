"""Website audit scraper — Phase 8.

Reads a leads CSV (output of ``maps_cold_calling``) and audits each
business's website for SEO, content, design, blog presence, page count,
tech stack, and domain age. Outputs the same CSV with appended ``site_*``
columns and a CALL / MAYBE / SKIP verdict per row.

Typical usage::

    python -m maps_cold_calling.audit --input leads.csv --output leads-audited.csv
"""

from __future__ import annotations

__all__: list[str] = []
