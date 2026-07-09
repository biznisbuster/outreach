"""Site Audit package.

Public entry points:
- ``runner.run_audit(lead_id)`` — high-level orchestrator. Loads the latest
  scrape for a lead, computes every per-page and site-wide metric, scores the
  site on multiple criteria, persists the result, and returns the report dict.

Modules:
    security, performance, content, accessibility, mobile, structured,
    onpage, tech_stack, traffic, aggregate, site_rank, runner.
"""
from . import runner, site_rank  # noqa: F401
