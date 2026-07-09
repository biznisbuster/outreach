/** POST /api/import/commit — komituj import (ubaci leadove u bazu). */
import type { APIRoute } from "astro";
import { ok, bad, getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { dedupKey } from "../../../lib/dedup";
import { randomUUID } from "node:crypto";
import { logAudit } from "../../../lib/audit";

const commitSchema = z.object({
  campaignId: z.number(),
  leads: z
    .array(
      z.object({
        name: z.string(),
        category: z.string().nullable().optional(),
        phoneRaw: z.string().nullable().optional(),
        phoneE164: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        websiteRaw: z.string().nullable().optional(),
        websiteNormalized: z.string().nullable().optional(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        postalCode: z.string().nullable().optional(),
        googleRating: z.number().nullable().optional(),
        reviewsCount: z.number().nullable().optional(),
        source: z.string().nullable().optional(),
        sourceUrl: z.string().nullable().optional(),
        dedup: z.string().optional(),
      }),
    )
    .min(1),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = commitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const { campaignId, leads } = parsed.data;
  const db = getDb();

  const [campaign] = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, campaignId)).all();
  if (!campaign) return bad("Kampanja ne postoji");

  const batchId = randomUUID();
  const defaultStatus = db
    .select()
    .from(schema.statuses)
    .where(eq(schema.statuses.name, "Novi"))
    .limit(1)
    .all()[0];

  let inserted = 0;
  let skipped = 0;
  const tx = db.transaction((rows: typeof leads) => {
    for (const l of rows) {
      const dedup = l.dedup || dedupKey({ website: l.websiteNormalized, phoneE164: l.phoneE164, name: l.name, city: l.city });
      const exists = db
        .select({ id: schema.leads.id })
        .from(schema.leads)
        .where(eq(schema.leads.dedupKey, dedup))
        .limit(1)
        .all();
      if (exists.length > 0) {
        skipped++;
        continue;
      }
      db.insert(schema.leads)
        .values({
          campaignId,
          name: l.name,
          category: l.category ?? null,
          phoneRaw: l.phoneRaw ?? null,
          phoneE164: l.phoneE164 ?? null,
          email: l.email ?? null,
          websiteRaw: l.websiteRaw ?? null,
          websiteNormalized: l.websiteNormalized ?? null,
          address: l.address ?? null,
          city: l.city ?? null,
          postalCode: l.postalCode ?? null,
          googleRating: l.googleRating ?? null,
          reviewsCount: l.reviewsCount ?? null,
          source: l.source ?? null,
          sourceUrl: l.sourceUrl ?? null,
          statusId: defaultStatus?.id ?? null,
          dedupKey: dedup,
          importBatchId: batchId,
        })
        .run();
      inserted++;
    }
  });
  tx(leads);

  logAudit("lead.import", "campaign", campaignId, { inserted, skipped, batchId, total: leads.length });
  return ok({ ok: true, inserted, skipped, batchId }, 201);
};
