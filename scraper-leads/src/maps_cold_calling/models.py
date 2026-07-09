"""Domain models for the scraper.

The central type is :class:`Business` — one row of cold-outreach data per
discovered place. Sub-tasks serialize the dataclass to CSV (Phase 1.7), JSON
(Phase 5.2), and SQLite (Phase 5.3).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, ClassVar


@dataclass
class Business:
    """One discovered business — local lead for cold outreach.

    Field semantics:
    - ``phone_raw`` keeps Google's original formatting (often has spaces).
    - ``phone_e164`` is the normalized form (Phase 2.2) — used for dedupe.
    - ``email`` is left ``None`` unless ``--extract-emails`` is on (Phase 4).
    - ``hours_json`` is a free-form dict because Google returns textual
      strings like "08:00–20:00" depending on language; the CSV exporter
      in Phase 5.4 will normalize per-day columns.
    - ``source`` records which adapter produced the row (``maps`` | ``planplus``).
    - ``scraped_at`` is set on construction to UTC ISO-8601.
    """

    name: str
    address: str | None = None
    city: str | None = None
    country: str | None = None
    phone_raw: str | None = None
    phone_e164: str | None = None
    website: str | None = None
    email: str | None = None
    extra_emails: str | None = None     # JSON lista, scrape-ovano sa sajta
    extra_phones: str | None = None     # JSON lista (stringified), scrape-ovano sa sajta
    screenshot_path: str | None = None  # relativna putanja do homepage screenshot-a
    discovery_method: str = "maps"     # "maps" | "maps+website" | "maps+google"
    category: str | None = None
    rating: float | None = None
    reviews_count: int | None = None
    latitude: float | None = None
    longitude: float | None = None
    google_place_id: str | None = None
    google_maps_url: str | None = None
    hours_json: dict[str, Any] | None = None
    source: str = "maps"
    scraped_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))

    def __post_init__(self) -> None:
        if not self.name or not self.name.strip():
            raise ValueError("Business.name must be a non-empty string")

    # ────────────────────── serialization ──────────────────────

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Business:
        # Filter unknown keys so JSONL checkpoints from older versions still load.
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})

    def to_csv_row(self) -> dict[str, str]:
        """Flatten for CSV — JSON-y fields become their string form."""
        d = self.to_dict()
        if d.get("hours_json") is not None:
            d["hours_json"] = json.dumps(d["hours_json"], ensure_ascii=False)
        out: dict[str, str] = {}
        for k, v in d.items():
            if v is None:
                out[k] = ""
            elif isinstance(v, (int, float)):
                out[k] = str(v)
            else:
                out[k] = str(v)
        return out

    CSV_COLUMNS: ClassVar[tuple[str, ...]] = (
        "name",
        "address",
        "city",
        "country",
        "phone_e164",
        "phone_raw",
        "website",
        "email",
        "extra_emails",
        "extra_phones",
        "screenshot_path",
        "discovery_method",
        "category",
        "rating",
        "reviews_count",
        "latitude",
        "longitude",
        "google_place_id",
        "google_maps_url",
        "hours_json",
        "source",
        "scraped_at",
    )
