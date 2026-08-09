import { getDb, schema } from "./db";
import { sql, eq, and, gte, lt, isNotNull, ne, inArray } from "drizzle-orm";
import { getSettingInt } from "./settings";

export interface TodoItem {
  leadId: number;
  name: string;
  city: string | null;
  phoneE164: string | null;
  statusId: number | null;
  statusName: string | null;
  statusColor: string | null;
  reason: "followup_due" | "no_contact";
  daysOverdue: number;
}

/**
 * "Za zvanje danas" lista:
 *  (a) follow-up due: sent u poslednjih 7 dana, bez reply-ja, starije od 3d
 *      (aktivan status set)
 *  (b) aktivan bez kontakta: status u aktivnom setu, bez email_send-a ni
 *      komentara u poslednjih 5d
 *
 * Sortira se po prioritetu (follow-up pre bez-kontakta), pa daysOverdue DESC.
 * Dedupe po lead_id (ako se pojavi u oba seta, follow-up ima prioritet).
 */
export async function getCallTodo(limit?: number): Promise<TodoItem[]> {
  const db = getDb();
  const effectiveLimit = limit ?? (getSettingInt("dashboard_call_todo_limit") || 20);

  const activeStatuses = db
    .select({ id: schema.statuses.id, name: schema.statuses.name, color: schema.statuses.color })
    .from(schema.statuses)
    .where(and(eq(schema.statuses.isActive, true), eq(schema.statuses.isTerminalLost, false), eq(schema.statuses.isTerminalWon, false)))
    .all();
  const activeIds = activeStatuses.map((s) => s.id);

  if (activeIds.length === 0) return [];

  const now = Date.now();
  const followupWindowDays = getSettingInt("dashboard_followup_window_days") || 7;
  const followupMinAgeDays = getSettingInt("dashboard_followup_min_age_days") || 3;
  const noContactDays = getSettingInt("dashboard_no_contact_days") || 5;
  const cutoff7dMs = now - followupWindowDays * 24 * 60 * 60 * 1000;
  const cutoff3dMs = now - followupMinAgeDays * 24 * 60 * 60 * 1000;
  const cutoff5dMs = now - noContactDays * 24 * 60 * 60 * 1000;
  // Drizzle timestamp_ms polja čuvaju number (unixepoch()*1000), pa za Drizzle
  // typed where koristimo Date (on ih konvertuje), a za raw SQL template
  // interpolaciju koristimo broj (better-sqlite3 ne prihvata Date direktno).
  const cutoff7d = new Date(cutoff7dMs);
  const cutoff3d = new Date(cutoff3dMs);
  const cutoff5d = cutoff5dMs;

  // (a) Follow-up due — sent bez reply-ja stariji od 3d, mlađi od 7d
  const followupRows = db
    .select({
      leadId: schema.leads.id,
      name: schema.leads.name,
      city: schema.leads.city,
      phoneE164: schema.leads.phoneE164,
      statusId: schema.leads.statusId,
      sentAt: schema.emailSends.sentAt,
    })
    .from(schema.emailSends)
    .innerJoin(schema.leads, eq(schema.leads.id, schema.emailSends.leadId))
    .where(
      and(
        eq(schema.emailSends.status, "sent"),
        eq(schema.emailSends.replied, false),
        gte(schema.emailSends.sentAt, cutoff7d),
        lt(schema.emailSends.sentAt, cutoff3d),
        inArray(schema.leads.statusId, activeIds),
      ),
    )
    .all();

  // (b) Aktivan bez kontakta — bez email_send-a i bez komentara u poslednjih 5d
  const noContactRows = db
    .select({
      leadId: schema.leads.id,
      name: schema.leads.name,
      city: schema.leads.city,
      phoneE164: schema.leads.phoneE164,
      statusId: schema.leads.statusId,
      updatedAt: schema.leads.updatedAt,
    })
    .from(schema.leads)
    .where(
      and(
        inArray(schema.leads.statusId, activeIds),
        eq(schema.leads.doNotContact, false),
        sql`NOT EXISTS (SELECT 1 FROM email_sends es WHERE es.lead_id = ${schema.leads.id} AND es.queued_at >= ${cutoff5d})`,
        sql`NOT EXISTS (SELECT 1 FROM comments c WHERE c.lead_id = ${schema.leads.id} AND c.created_at >= ${cutoff5d})`,
      ),
    )
    .all();

  const statusMap = new Map(activeStatuses.map((s) => [s.id, s]));
  const dedup = new Map<number, TodoItem>();

  for (const r of followupRows) {
    if (dedup.has(r.leadId)) continue;
    const s = r.statusId !== null ? statusMap.get(r.statusId) : null;
    const sentMs = r.sentAt instanceof Date ? r.sentAt.getTime() : Number(r.sentAt);
    const days = Math.max(0, Math.floor((now - sentMs) / (24 * 60 * 60 * 1000)) - 3);
    dedup.set(r.leadId, {
      leadId: r.leadId,
      name: r.name,
      city: r.city,
      phoneE164: r.phoneE164,
      statusId: r.statusId,
      statusName: s?.name ?? null,
      statusColor: s?.color ?? null,
      reason: "followup_due",
      daysOverdue: days,
    });
  }

  for (const r of noContactRows) {
    if (dedup.has(r.leadId)) continue;
    const s = r.statusId !== null ? statusMap.get(r.statusId) : null;
    const updMs = r.updatedAt instanceof Date ? r.updatedAt.getTime() : Number(r.updatedAt);
    const days = Math.max(0, Math.floor((now - updMs) / (24 * 60 * 60 * 1000)) - 5);
    dedup.set(r.leadId, {
      leadId: r.leadId,
      name: r.name,
      city: r.city,
      phoneE164: r.phoneE164,
      statusId: r.statusId,
      statusName: s?.name ?? null,
      statusColor: s?.color ?? null,
      reason: "no_contact",
      daysOverdue: days,
    });
  }

  const list = Array.from(dedup.values());
  list.sort((a, b) => {
    if (a.reason !== b.reason) return a.reason === "followup_due" ? -1 : 1;
    return b.daysOverdue - a.daysOverdue;
  });
  return list.slice(0, effectiveLimit);
}