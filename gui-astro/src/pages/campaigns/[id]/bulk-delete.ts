/** POST /campaigns/[id]/bulk-delete — TRAJNO obriši sve leadove kampanje. */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "../../../lib/audit";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  const before = db.select({ id: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, id))
    .all();
  const count = before.length;
  // CASCADE na DB nivou briše comments, screenshots, emails, itd.
  db.delete(schema.leads).where(eq(schema.leads.campaignId, id)).run();
  logAudit("lead.bulk_delete", "campaign", id, { count });
  return redirect(`/campaigns/${id}?ok=Obrisano+${count}+leadova`, 303);
};
