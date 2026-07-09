/** POST /api/leads/bulk — bulk akcije: setStatus, blocklist, unblock, delete. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../../lib/api";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../../lib/audit";

const schema_ = z.object({
  action: z.enum(["setStatus", "blocklist", "unblock", "delete"]),
  leadIds: z.array(z.number().int().positive()).min(1),
  statusId: z.number().optional(),
  reason: z.string().optional(),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = schema_.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const { action, leadIds } = parsed.data;
  const db = getDb();

  if (action === "setStatus") {
    if (!parsed.data.statusId) return bad("statusId je obavezan");
    db.update(schema.leads)
      .set({ statusId: parsed.data.statusId, updatedAt: new Date() })
      .where(inArray(schema.leads.id, leadIds))
      .run();
    logAudit("lead.bulk_status", "lead", null, { leadIds, statusId: parsed.data.statusId });
    return ok({ ok: true, action, count: leadIds.length });
  }
  if (action === "blocklist") {
    // First check existing
    const existing = db
      .select({ leadId: schema.blocklist.leadId })
      .from(schema.blocklist)
      .where(inArray(schema.blocklist.leadId, leadIds))
      .all();
    const have = new Set(existing.map((r) => r.leadId));
    const toInsert = leadIds.filter((id) => !have.has(id));
    if (toInsert.length > 0) {
      for (const id of toInsert) {
        db.insert(schema.blocklist).values({ leadId: id, reason: parsed.data.reason ?? null }).run();
      }
      db.update(schema.leads)
        .set({ doNotContact: true })
        .where(inArray(schema.leads.id, toInsert))
        .run();
    }
    logAudit("lead.bulk_blocklist", "lead", null, { leadIds: toInsert });
    return ok({ ok: true, action, count: toInsert.length });
  }
  if (action === "unblock") {
    db.delete(schema.blocklist).where(inArray(schema.blocklist.leadId, leadIds)).run();
    db.update(schema.leads)
      .set({ doNotContact: false })
      .where(inArray(schema.leads.id, leadIds))
      .run();
    return ok({ ok: true, action, count: leadIds.length });
  }
  if (action === "delete") {
    db.delete(schema.leads).where(inArray(schema.leads.id, leadIds)).run();
    logAudit("lead.bulk_delete", "lead", null, { leadIds, count: leadIds.length });
    return ok({ ok: true, action, count: leadIds.length });
  }
  return bad("Unknown action");
};
