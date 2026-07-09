/** POST /api/sequences/steps — dodaj step. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../../lib/api";
import { z } from "zod";

const schema_ = z.object({
  sequenceId: z.number().int().positive(),
  stepNumber: z.number().int(),
  promptTemplateId: z.number().optional().nullable(),
  delayDays: z.number().int().default(0),
  sendWindowOnly: z.boolean().default(true),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = schema_.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const [created] = db.insert(schema.sequenceSteps).values(parsed.data).returning().all();
  return ok(created, 201);
};
