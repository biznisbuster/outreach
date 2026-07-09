/** GET / POST /api/prompts — list / create prompt templates. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../lib/api";
import { asc } from "drizzle-orm";
import { z } from "zod";

export const GET: APIRoute = async () => {
  const db = getDb();
  const items = db.select().from(schema.promptTemplates).orderBy(asc(schema.promptTemplates.id)).all();
  return ok({ items });
};

const createSchema = z.object({
  name: z.string().min(1),
  // U v2 (bez AI) koristimo samo "manual" tip; AI tipovi uklonjeni.
  type: z.string().default("manual"),
  body: z.string().min(1),
  isDefault: z.boolean().default(false),
  campaignId: z.number().optional().nullable(),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const [created] = db.insert(schema.promptTemplates).values(parsed.data).returning().all();
  return ok(created, 201);
};
