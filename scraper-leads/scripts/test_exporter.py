"""Quick smoke test of CSV/JSON writers + JSONL checkpoint."""
import json
from pathlib import Path

from maps_cold_calling.export.csv_writer import CsvWriter
from maps_cold_calling.export.json_writer import JsonWriter
from maps_cold_calling.models import Business
from maps_cold_calling.storage.checkpoint import JsonlCheckpoint, ResumeReader


def main() -> int:
    # Two test businesses
    b1 = Business(
        name="Test 1",
        address="Adresa 1",
        city="Testville",
        country="RS",
        phone_raw="037111222",
        phone_e164="+38137111222",
        website="https://example.com",
        rating=4.7,
        latitude=43.5,
        longitude=21.3,
        google_place_id="ChIJa1b1",
    )
    b2 = Business(
        name="Test 2",
        address="Adresa 2",
        city="Testville",
        country="RS",
        phone_raw="0641234567",
        phone_e164="+381641234567",
        website=None,
        rating=4.0,
        latitude=43.6,
        longitude=21.4,
        google_place_id="ChIJa2b2",
    )

    # CSV
    with CsvWriter("/tmp/test_output.csv") as w:
        w.add(b1)
        w.add(b2)
    print("csv: OK")

    # JSON
    with JsonWriter("/tmp/test_output.json") as w:
        w.add(b1)
        w.add(b2)
    with open("/tmp/test_output.json") as f:
        data = json.load(f)
    assert len(data) == 2, f"expected 2 rows, got {len(data)}"
    assert data[0]["name"] == "Test 1"
    print("json: OK")

    # JSONL checkpoint — append b1, then read it back
    ckpt_path = Path("/tmp/test_ckpt.jsonl")
    if ckpt_path.exists():
        ckpt_path.unlink()
    ck = JsonlCheckpoint(ckpt_path)
    ck.append(b1)
    ck.append(b2)
    ck.close()

    # Read back
    rr = ResumeReader(ckpt_path)
    assert len(rr.businesses) == 2, f"expected 2 resumed, got {len(rr.businesses)}"
    assert "ChIJa1b1" in rr.seen_place_ids
    assert "ChIJa2b2" in rr.seen_place_ids
    print("checkpoint round-trip: OK")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
