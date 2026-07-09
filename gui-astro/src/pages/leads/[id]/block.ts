/** POST /leads/[id]/block — dodaj na blocklist. */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  const existing = db.select().from(schema.blocklist).where(eq(schema.blocklist.leadId, id)).all();
  if (existing.length === 0) db.insert(schema.blocklist).values({ leadId: id, reason: "user" }).run();
  db.update(schema.leads).set({ doNotContact: true }).where(eq(schema.leads.id, id)).run();
  return redirect(`/leads/${id}?ok=Blokiran`, 303);
};
