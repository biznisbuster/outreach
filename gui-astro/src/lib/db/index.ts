import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import * as schema from "./schema";

// Load .env from project root (one level up from src/lib/db).
// Astro doesn't auto-load it for runtime modules — load explicitly so the DB
// path is correct in both dev (`astro dev`) and prod (`node dist/server/...`).
const _here = path.dirname(fileURLToPath(import.meta.url));
const _envCandidates = [
  path.resolve(_here, "..", "..", "..", ".env"), // dist/server/chunks/ → project root
  path.resolve(_here, "..", "..", "..", "..", ".env"),
  path.resolve(process.cwd(), ".env"),
  path.resolve(process.cwd(), "..", ".env"),
];
for (const p of _envCandidates) {
  if (fs.existsSync(p)) {
    dotenv.config({ path: p, override: false });
    break;
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __outreachDb: { db: BetterSQLite3Database<typeof schema>; raw: Database.Database } | undefined;
}

function resolveDbPath(): string {
  const raw = process.env.DATABASE_URL ?? "file:/data/outreach.db";
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

  // Pokreni migracije ako postoje (delimo isti folder sa web/ aplikacijom)
  const candidates = [
    path.join(process.cwd(), "drizzle"),
    path.join(process.cwd(), "..", "web", "drizzle"),
    path.resolve(process.cwd(), "../../web/drizzle"),
  ];
  const migrationsFolder = candidates.find((c) => fs.existsSync(c));
  if (migrationsFolder) {
    try {
      migrate(db, { migrationsFolder });
    } catch (e) {
      console.error("[db] migration warning:", e);
    }
  }

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

    -- site_audits — multi-criteria site ranking (created by scraper/audit/).
    -- Same shape as gui-astro/src/lib/db/schema.ts (siteAudits). Belt-and-suspenders:
    -- if the app was started before schema.ts was updated, the tables still appear.
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
