/** POST /campaigns/[id]/bulk-blocklist — blokiraj sve leadove kampanje (do_not_contact). */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq, notInArray, and } from "drizzle-orm";
import { logAudit } from "../../../lib/audit";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  // nadji sve leadove koji vec NISU na blocklist
  const leads = db
    .select({ id: schema.leads.id })
    .from(schema.leads)
    .leftJoin(schema.blocklist, eq(schema.blocklist.leadId, schema.leads.id))
    .where(eq(schema.leads.campaignId, id))
    .all();
  const existing = new Set(
    db.select({ leadId: schema.blocklist.leadId })
      .from(schema.blocklist)
      .all()
      .map((r) => r.leadId),
  );
  const toInsert = leads.filter((l) => !existing.has(l.id)).map((l) => ({ leadId: l.id, reason: "campaign-bulk" }));
  if (toInsert.length > 0) {
    db.insert(schema.blocklist).values(toInsert).run();
  }
  db.update(schema.leads)
    .set({ doNotContact: true })
    .where(eq(schema.leads.campaignId, id))
    .run();
  logAudit("lead.bulk_blocklist", "campaign", id, { count: toInsert.length });
  return redirect(`/campaigns/${id}?ok=Blokirano+${toInsert.length}+leadova`, 303);
};
