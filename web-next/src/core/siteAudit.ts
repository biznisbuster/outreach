/**
 * Site audit data access (site_audits + site_audit_metrics tables).
 *
 * Written for the audit produced by the Python scraper service
 * (scraper/app/audit/*). Pure DB reads — the actual audit work lives in
 * the scraper. The Astro app calls /api/site-audit/[leadId]/run which
 * proxies to the scraper, then refreshes from these helpers.
 */
import { desc, eq } from "drizzle-orm";
import { getDb, getRaw, schema } from "./db";

export interface AuditCategory {
  score: number;
  weight: number;
  weighted: number;
  issues: string[];
}

export type Verdict = "critical" | "below_avg" | "average" | "good" | "excellent";
export type AuditRow = typeof schema.siteAudits.$inferSelect;
export type AuditMetricRow = typeof schema.siteAuditMetrics.$inferSelect;

/** Parse a JSON string from a column, returning a sane default if missing. */
function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (s === null || s === undefined || s === "") return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** Return the latest audit row for a lead as a hydrated report object, or null. */
export function getLatestAuditForLead(leadId: number) {
  const db = getDb();
  const [row] = db
    .select()
    .from(schema.siteAudits)
    .where(eq(schema.siteAudits.leadId, leadId))
    .orderBy(desc(schema.siteAudits.id))
    .limit(1)
    .all();
  if (!row) return null;
  return hydrateAudit(row);
}

/** Return a single audit row by id (or null). */
export function getAuditById(auditId: number) {
  const db = getDb();
  const [row] = db
    .select()
    .from(schema.siteAudits)
    .where(eq(schema.siteAudits.id, auditId))
    .all();
  if (!row) return null;
  return hydrateAudit(row);
}

/** Return every audit row for a lead (newest first). */
export function listAuditsForLead(leadId: number, limit = 20) {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.siteAudits)
    .where(eq(schema.siteAudits.leadId, leadId))
    .orderBy(desc(schema.siteAudits.id))
    .limit(limit)
    .all();
  return rows.map(hydrateAudit);
}

/** Return per-category rows (site_audit_metrics) for an audit. */
export function getAuditMetrics(auditId: number): AuditMetricRow[] {
  const db = getDb();
  return db
    .select()
    .from(schema.siteAuditMetrics)
    .where(eq(schema.siteAuditMetrics.auditId, auditId))
    .all();
}

function hydrateAudit(row: AuditRow) {
  return {
    ...row,
    top_issues: parseJson<string[]>(row.topIssuesJson as unknown as string, []),
    categories: parseJson<Record<string, AuditCategory>>(
      row.categoryScoresJson as unknown as string,
      {},
    ),
    metrics: parseJson<Record<string, unknown>>(row.metricsJson as unknown as string, {}),
    createdAtIso: typeof row.createdAt === "number"
      ? new Date(row.createdAt).toISOString()
      : null,
  };
}

/** Number of audits ever produced for a lead (cheap count for badge display). */
export function countAuditsForLead(leadId: number): number {
  const raw = getRaw();
  try {
    const r = raw
      .prepare(`SELECT COUNT(*) as c FROM site_audits WHERE lead_id = ?`)
      .get(leadId) as { c: number };
    return r?.c ?? 0;
  } catch {
    // tables don't exist yet on first start — return 0 silently
    return 0;
  }
}
