/** POST /leads/[id]/status — set status (form action from detail page). */
import type { APIRoute } from "astro";
import { getDb, schema, bad, ok } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "../../../lib/audit";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const statusIdRaw = form.get("statusId");
  const statusId = statusIdRaw === "" || statusIdRaw === null ? null : Number(statusIdRaw);

  const db = getDb();
  const before = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all()[0];
  if (!before) return bad("Lead ne postoji");

  db.update(schema.leads)
    .set({ statusId, updatedAt: new Date() })
    .where(eq(schema.leads.id, id))
    .run();
  logAudit("lead.status_change", "lead", id, { from: before.statusId, to: statusId });
  return redirect(`/leads/${id}?ok=${encodeURIComponent("Status ažuriran")}`, 303);
};
