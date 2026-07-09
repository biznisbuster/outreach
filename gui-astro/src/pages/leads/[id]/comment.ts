/** POST /leads/[id]/comment — add comment. */
import type { APIRoute } from "astro";
import { getDb, schema, bad } from "../../../lib/api";

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const body = String(form.get("body") ?? "").trim();
  if (!body) return bad("Prazan komentar", 303);

  const db = getDb();
  db.insert(schema.comments).values({ leadId: id, body }).run();
  return redirect(`/leads/${id}?ok=Komentar+dodat`, 303);
};
