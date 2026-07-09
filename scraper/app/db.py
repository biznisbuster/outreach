"""Pristup istom SQLite fajlu kao Next.js app.
WAL mode + busy timeout radi bezbedne konkurentne pristup (single-user).
"""
import json
import sqlite3
import os
import threading
import time
from contextlib import contextmanager

DB_PATH = os.environ.get("DATABASE_PATH", "/data/outreach.db")

_local = threading.local()


def get_db() -> sqlite3.Connection:
    conn = getattr(_local, "conn", None)
    if conn is None:
        conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=10000")
        conn.execute("PRAGMA foreign_keys=ON")
        _local.conn = conn
    return conn


@contextmanager
def tx():
    conn = get_db()
    try:
        conn.execute("BEGIN")
        yield conn
        conn.execute("COMMIT")
    except Exception:
        conn.execute("ROLLBACK")
        raise


def get_lead(lead_id: int) -> dict | None:
    conn = get_db()
    row = conn.execute(
        "SELECT id, name, website_normalized, website_raw FROM leads WHERE id = ?", (lead_id,)
    ).fetchone()
    if not row:
        return None
    return dict(row)


def create_scrape(lead_id: int, domain: str, sitemap_url: str | None) -> int:
    conn = get_db()
    cur = conn.execute(
        "INSERT INTO site_scrapes (lead_id, domain, sitemap_url, status, started_at) "
        "VALUES (?, ?, ?, 'running', ?)",
        (lead_id, domain, sitemap_url, int(time.time() * 1000)),
    )
    conn.commit()
    return cur.lastrowid


def update_scrape(scrape_id: int, **fields):
    conn = get_db()
    sets = ", ".join(f"{k} = ?" for k in fields)
    conn.execute(
        f"UPDATE site_scrapes SET {sets} WHERE id = ?",
        (*fields.values(), scrape_id),
    )
    conn.commit()


def insert_page(scrape_id: int, page: dict):
    conn = get_db()
    conn.execute(
        "INSERT INTO site_pages (scrape_id, url, category, title, meta_description, h1, "
        "word_count, reading_time, seo_metrics_json, body_summary, status_code, fetched_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (
            scrape_id,
            page.get("url"),
            page.get("category"),
            page.get("title"),
            page.get("meta_description"),
            page.get("h1"),
            page.get("word_count", 0),
            page.get("reading_time", 0),
            json.dumps(page.get("seo_metrics", {}), ensure_ascii=False),
            page.get("body_summary"),
            page.get("status_code"),
            int(time.time() * 1000),
        ),
    )
    conn.commit()


def insert_screenshot(lead_id: int, path: str):
    conn = get_db()
    import time
    conn.execute(
        "INSERT INTO screenshots (lead_id, path, captured_at) VALUES (?, ?, ?)",
        (lead_id, path, int(time.time() * 1000)),
    )
    conn.commit()


# ---------------------------------------------------------------------------
# site_audits + site_audit_metrics — produced by the audit/ package.
# ---------------------------------------------------------------------------

def get_latest_successful_scrape(lead_id: int) -> dict | None:
    """Return the most-recent site_scrapes row for a lead with status='done'."""
    conn = get_db()
    row = conn.execute(
        "SELECT id, domain, sitemap_url, total_pages_discovered, pages_scraped, "
        "started_at, finished_at, status "
        "FROM site_scrapes WHERE lead_id = ? AND status = 'done' "
        "ORDER BY id DESC LIMIT 1",
        (lead_id,),
    ).fetchone()
    return dict(row) if row else None


def get_scrape_page_urls(scrape_id: int, limit: int = 50) -> list[str]:
    """Return distinct URLs (in original order) from the site_pages row."""
    conn = get_db()
    rows = conn.execute(
        "SELECT DISTINCT url FROM site_pages WHERE scrape_id = ? ORDER BY id LIMIT ?",
        (scrape_id, limit),
    ).fetchall()
    return [r["url"] for r in rows]


def create_audit(report: dict, audit_id: int | None = None) -> int:
    """Persist the audit result. Returns the new audit row id."""
    conn = get_db()
    if audit_id is None:
        cur = conn.execute(
            "INSERT INTO site_audits ("
            "  lead_id, scrape_id, domain, overall_rank, verdict, verdict_label, "
            "  pitch_advice, top_issues_json, category_scores_json, metrics_json, "
            "  duration_ms, created_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                report["lead_id"],
                report.get("scrape_id"),
                report.get("domain"),
                int(report.get("overall_rank", 0)),
                report.get("verdict", "average"),
                report.get("verdict_label", ""),
                report.get("pitch_advice", ""),
                json.dumps(report.get("top_issues", []), ensure_ascii=False),
                json.dumps(report.get("categories", {}), ensure_ascii=False),
                json.dumps(report.get("metrics", {}), ensure_ascii=False),
                int(report.get("duration_ms", 0)),
                int(report.get("created_at", int(time.time() * 1000))),
            ),
        )
        conn.commit()
        return cur.lastrowid
    else:
        # Manual id (used for tests / restoring snapshots)
        conn.execute(
            "INSERT INTO site_audits ("
            "  id, lead_id, scrape_id, domain, overall_rank, verdict, verdict_label, "
            "  pitch_advice, top_issues_json, category_scores_json, metrics_json, "
            "  duration_ms, created_at"
            ") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                audit_id,
                report["lead_id"],
                report.get("scrape_id"),
                report.get("domain"),
                int(report.get("overall_rank", 0)),
                report.get("verdict", "average"),
                report.get("verdict_label", ""),
                report.get("pitch_advice", ""),
                json.dumps(report.get("top_issues", []), ensure_ascii=False),
                json.dumps(report.get("categories", {}), ensure_ascii=False),
                json.dumps(report.get("metrics", {}), ensure_ascii=False),
                int(report.get("duration_ms", 0)),
                int(report.get("created_at", int(time.time() * 1000))),
            ),
        )
        conn.commit()
        return audit_id


def create_audit_metrics(audit_id: int, ranked: dict) -> None:
    """Persist per-category metric rows for a site_audit."""
    conn = get_db()
    for category, data in ranked.items():
        conn.execute(
            "INSERT INTO site_audit_metrics ("
            "  audit_id, category, score, weight, weighted, issues_json, raw_json"
            ") VALUES (?, ?, ?, ?, ?, ?, ?)",
            (
                audit_id,
                category,
                int(data.get("score", 0)),
                float(data.get("weight", 0)),
                float(data.get("weighted", 0)),
                json.dumps(data.get("issues", []), ensure_ascii=False),
                "",  # raw metrics are stored once on site_audits.metrics_json
            ),
        )
    conn.commit()


def get_audit_by_id(audit_id: int) -> dict | None:
    """Return the full audit report dict (rehydrated from JSON columns)."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM site_audits WHERE id = ?",
        (audit_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_report(row)


def get_latest_audit_for_lead(lead_id: int) -> dict | None:
    """Return the most recent audit report dict for a lead, or None."""
    conn = get_db()
    row = conn.execute(
        "SELECT * FROM site_audits WHERE lead_id = ? ORDER BY id DESC LIMIT 1",
        (lead_id,),
    ).fetchone()
    if not row:
        return None
    return _row_to_report(row)


def _row_to_report(row) -> dict:
    d = dict(row)
    if d.get("top_issues_json"):
        try:
            d["top_issues"] = json.loads(d.pop("top_issues_json"))
        except Exception:
            d["top_issues"] = []
    if d.get("category_scores_json"):
        try:
            d["categories"] = json.loads(d.pop("category_scores_json"))
        except Exception:
            d["categories"] = {}
    if d.get("metrics_json"):
        try:
            d["metrics"] = json.loads(d.pop("metrics_json"))
        except Exception:
            d["metrics"] = {}
    # Convert epoch ms → ISO for ease of use
    for k in ("created_at",):
        if d.get(k):
            try:
                from datetime import datetime
                d[k + "_iso"] = datetime.utcfromtimestamp(d[k] / 1000).strftime("%Y-%m-%dT%H:%M:%SZ")
            except Exception:
                pass
    return d
