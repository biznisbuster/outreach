import { getDb, getRaw } from "./db";

export type AuditAction =
  | "lead.create"
  | "lead.update"
  | "lead.delete"
  | "lead.status_change"
  | "lead.bulk_delete"
  | "lead.bulk_status"
  | "lead.bulk_blocklist"
  | "lead.import"
  | "scrape.start"
  | "scrape.complete"
  | "analyze.start"
  | "analyze.complete"
  | "settings.change"
  | "campaign.create"
  | "campaign.delete";

export interface AuditEntry {
  id: number;
  ts: number;
  actor: string;
  action: AuditAction;
  entity: string;
  entity_id: number | null;
  meta: Record<string, unknown> | null;
}

export function logAudit(
  action: AuditAction,
  entity: string,
  entityId: number | null,
  meta?: Record<string, unknown>,
  actor = "user",
): void {
  try {
    const raw = getRaw();
    raw
      .prepare(
        `INSERT INTO audit_log (actor, action, entity, entity_id, meta) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(actor, action, entity, entityId, meta ? JSON.stringify(meta) : null);
  } catch (e) {
    console.error("[audit] failed to log:", action, e);
  }
}

export interface AuditQuery {
  entity?: string;
  entityId?: number;
  action?: AuditAction;
  limit?: number;
  offset?: number;
}

export function listAudit(q: AuditQuery = {}): AuditEntry[] {
  const raw = getRaw();
  const where: string[] = [];
  const params: unknown[] = [];
  if (q.entity) {
    where.push("entity = ?");
    params.push(q.entity);
  }
  if (q.entityId !== undefined) {
    where.push("entity_id = ?");
    params.push(q.entityId);
  }
  if (q.action) {
    where.push("action = ?");
    params.push(q.action);
  }
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = q.limit ?? 100;
  const offset = q.offset ?? 0;
  const rows = raw
    .prepare(
      `SELECT id, ts, actor, action, entity, entity_id, meta FROM audit_log ${whereSql} ORDER BY ts DESC LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset) as Array<{
    id: number;
    ts: number;
    actor: string;
    action: string;
    entity: string;
    entity_id: number | null;
    meta: string | null;
  }>;
  return rows.map((r) => ({
    id: r.id,
    ts: r.ts,
    actor: r.actor,
    action: r.action as AuditAction,
    entity: r.entity,
    entity_id: r.entity_id,
    meta: r.meta ? (JSON.parse(r.meta) as Record<string, unknown>) : null,
  }));
}

export function leadHistory(leadId: number, limit = 50): AuditEntry[] {
  return listAudit({ entity: "lead", entityId: leadId, limit });
}

export function recentLeadEvents(limit = 50): AuditEntry[] {
  return listAudit({ entity: "lead", limit });
}