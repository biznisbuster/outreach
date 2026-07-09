/** POST /leads/[id]/unblock — skini sa blockliste. */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.blocklist).where(eq(schema.blocklist.leadId, id)).run();
  db.update(schema.leads).set({ doNotContact: false }).where(eq(schema.leads.id, id)).run();
  return redirect(`/leads/${id}?ok=Odblokiran`, 303);
};
