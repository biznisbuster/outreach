/** POST /campaigns/[id]/bulk-status — primeni status na sve leadove kampanje. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "../../../lib/audit";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const statusId = Number(form.get("statusId"));
  if (!statusId) return redirect(`/campaigns/${id}?error=Izaberi+status`, 303);

  const db = getDb();
  const updated = db
    .update(schema.leads)
    .set({ statusId, updatedAt: new Date() })
    .where(eq(schema.leads.campaignId, id))
    .run();
  logAudit("lead.bulk_status", "campaign", id, { statusId, count: updated.changes });
  return redirect(`/campaigns/${id}?ok=Status+primenjen+na+${updated.changes}+leadova`, 303);
};

void ok; void bad;
