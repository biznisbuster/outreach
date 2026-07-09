/** GET / POST /api/sequences. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, qpInt } from "../../lib/api";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

export const GET: APIRoute = async ({ url }) => {
  const campaignId = qpInt(url.searchParams.get("campaignId"), 0);
  const db = getDb();
  const conds = [];
  if (campaignId) conds.push(eq(schema.sequences.campaignId, campaignId));
  const items = db
    .select()
    .from(schema.sequences)
    .where(conds.length ? and(...conds) : undefined)
    .all();
  // Steps za svaku
  const sequencesWithSteps = items.map((s) => ({
    ...s,
    steps: db
      .select()
      .from(schema.sequenceSteps)
      .where(eq(schema.sequenceSteps.sequenceId, s.id))
      .all(),
  }));
  return ok({ items: sequencesWithSteps });
};

const createSchema = z.object({
  campaignId: z.number().int().positive(),
  name: z.string().min(1),
  steps: z
    .array(
      z.object({
        stepNumber: z.number().int(),
        promptTemplateId: z.number().optional().nullable(),
        delayDays: z.number().int().default(0),
        sendWindowOnly: z.boolean().default(true),
      }),
    )
    .optional()
    .default([]),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const { steps, ...rest } = parsed.data;
  const db = getDb();
  const [seq] = db.insert(schema.sequences).values(rest).returning().all();
  if (!seq) return bad("Ne mogu da kreiram sekvencu");
  for (const st of steps) {
    db.insert(schema.sequenceSteps)
      .values({
        sequenceId: seq.id,
        stepNumber: st.stepNumber,
        promptTemplateId: st.promptTemplateId ?? null,
        delayDays: st.delayDays,
        sendWindowOnly: st.sendWindowOnly,
      })
      .run();
  }
  return ok({ ...seq, steps }, 201);
};
