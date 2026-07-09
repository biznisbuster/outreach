/** PATCH / DELETE /api/prompts/[id]. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, notFound } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().optional(),
  body: z.string().optional(),
  isDefault: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const data = { ...parsed.data, updatedAt: new Date() };
  const [updated] = db.update(schema.promptTemplates).set(data).where(eq(schema.promptTemplates.id, id)).returning().all();
  if (!updated) return notFound();
  return ok(updated);
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.promptTemplates).where(eq(schema.promptTemplates.id, id)).run();
  return ok({ ok: true });
};
