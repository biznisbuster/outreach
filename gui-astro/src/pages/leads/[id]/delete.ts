/** POST /leads/[id]/delete — TRAJNO obriši lead. */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { logAudit } from "../../../lib/audit";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.leads).where(eq(schema.leads.id, id)).run();
  logAudit("lead.delete", "lead", id);
  return redirect(`/leads?ok=Obrisan+lead+%23${id}`, 303);
};
