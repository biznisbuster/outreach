"""Pristup istom SQLite fajlu kao Next.js app.
WAL mode + busy timeout radi bezbedne konkurentne pristup (single-user).
"""
import sqlite3
import os
import threading
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
    return dict(row) if row else None


def create_scrape(lead_id: int, domain: str, sitemap_url: str | None) -> int:
    conn = get_db()
    import time
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
    import json, time
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
