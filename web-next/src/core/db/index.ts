import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/**
 * Centralna SQLite konekcija (WAL, shared-cache singleton preko globalThis —
 * preživljava Next dev HMR bez duplih konekcija).
 *
 * Next automatski učitava .env / .env.local u process.env — dotenv nije potreban.
 * DATABASE_URL je relativan u odnosu na web-next/ (npr. file:../data/outreach.db).
 *
 * Šema je 1:1 sa gui-astro; postojeća baza je već potpuno migrirana, pa se
 * struktura garantuje belt-and-suspenders CREATE TABLE IF NOT EXISTS blokom.
 */

declare global {
  var __outreachDb: { db: BetterSQLite3Database<typeof schema>; raw: Database.Database } | undefined;
}

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? "file:../data/outreach.db";
  const p = raw.startsWith("file:") ? raw.slice(5) : raw;
  return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p);
}

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function createConnection() {
  const dbPath = resolveDbPath();
  ensureDir(dbPath);

  const raw = new Database(dbPath);
  raw.pragma("journal_mode = WAL");
  raw.pragma("synchronous = NORMAL");
  raw.pragma("busy_timeout = 5000");
  raw.pragma("foreign_keys = ON");

  const db = drizzle(raw, { schema });

  raw.exec(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      actor TEXT NOT NULL DEFAULT 'system',
      action TEXT NOT NULL,
      entity TEXT NOT NULL,
      entity_id INTEGER,
      meta TEXT
    );
    CREATE INDEX IF NOT EXISTS audit_log_ts_idx ON audit_log(ts);
    CREATE INDEX IF NOT EXISTS audit_log_entity_idx ON audit_log(entity, entity_id);

    CREATE TABLE IF NOT EXISTS site_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
      scrape_id INTEGER REFERENCES site_scrapes(id) ON DELETE SET NULL,
      domain TEXT,
      overall_rank INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      verdict_label TEXT,
      pitch_advice TEXT,
      top_issues_json TEXT,
      category_scores_json TEXT,
      metrics_json TEXT,
      duration_ms INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER DEFAULT (unixepoch() * 1000)
    );
    CREATE INDEX IF NOT EXISTS site_audits_lead_id_idx ON site_audits(lead_id);
    CREATE INDEX IF NOT EXISTS site_audits_overall_rank_idx ON site_audits(overall_rank);

    CREATE TABLE IF NOT EXISTS site_audit_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER NOT NULL REFERENCES site_audits(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      score INTEGER NOT NULL,
      weight REAL NOT NULL,
      weighted REAL NOT NULL,
      issues_json TEXT,
      raw_json TEXT
    );
    CREATE INDEX IF NOT EXISTS site_audit_metrics_audit_id_idx ON site_audit_metrics(audit_id);
  `);

  return { db, raw };
}

export function getDb() {
  if (!globalThis.__outreachDb) {
    globalThis.__outreachDb = createConnection();
  }
  return globalThis.__outreachDb.db;
}

export function getRaw() {
  if (!globalThis.__outreachDb) {
    globalThis.__outreachDb = createConnection();
  }
  return globalThis.__outreachDb.raw;
}

export { schema };
