"""Vraća poslednje N sekcija CHANGELOG.md iz scraper-leads projekta."""
from __future__ import annotations

import re
from pathlib import Path

from fastapi import HTTPException

CHANGELOG_PATH = Path("/Users/marko/Documents/Outreach/scraper-leads/.agent_output/state/history/CHANGELOG.md")
MAX_ENTRIES = 12


def _read_changelog(limit: int) -> list[dict[str, str]]:
    if not CHANGELOG_PATH.exists():
        raise HTTPException(404, "CHANGELOG.md ne postoji")
    text = CHANGELOG_PATH.read_text(encoding="utf-8")
    # Svaki unos počinje sa "## YYYY-MM-DD —"
    pattern = re.compile(r"^## (\d{4}-\d{2}-\d{2}) — (.+?)$", re.MULTILINE)
    matches = list(pattern.finditer(text))
    entries: list[dict[str, str]] = []
    for i, m in enumerate(matches):
        start = m.end()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body = text[start:end].strip()
        entries.append({
            "date": m.group(1),
            "title": m.group(2).strip(),
            "body": body,
        })
    entries.reverse()  # newest first
    return entries[:limit]


def get_changelog(limit: int = MAX_ENTRIES) -> dict:
    """Return latest changelog entries + metadata for the UI."""
    return {
        "entries": _read_changelog(limit),
        "version": "0.2.0",
        "scraperSource": "scrape_v3.zip",
        "installedAt": CHANGELOG_PATH.stat().st_mtime if CHANGELOG_PATH.exists() else None,
    }


__all__ = ["get_changelog", "CHANGELOG_PATH", "MAX_ENTRIES"]