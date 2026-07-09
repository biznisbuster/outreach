/** POST /api/leads/[id]/comments — dodaj komentar. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../../../lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

const schema_ = z.object({ body: z.string().min(1) });

export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = schema_.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const [created] = db
    .insert(schema.comments)
    .values({ leadId: id, body: parsed.data.body })
    .returning()
    .all();
  return ok(created, 201);
};

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  const items = db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.leadId, id))
    .all();
  return ok({ items });
};
