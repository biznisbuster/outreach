/** GET / PATCH / DELETE /api/campaigns/[id] */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, notFound } from "../../../lib/api";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../../lib/audit";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  const [row] = db
    .select({
      campaign: schema.campaigns,
      leadCount: sql<number>`(SELECT COUNT(*) FROM leads WHERE campaign_id = ${schema.campaigns.id})`,
    })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, id))
    .all();
  if (!row) return notFound();
  return ok(row);
};

const patchSchema = z.object({
  name: z.string().optional(),
  category: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const [updated] = db
    .update(schema.campaigns)
    .set(parsed.data)
    .where(eq(schema.campaigns.id, id))
    .returning()
    .all();
  if (!updated) return notFound();
  return ok(updated);
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.campaigns).where(eq(schema.campaigns.id, id)).run();
  logAudit("campaign.delete", "campaign", id);
  return ok({ ok: true });
};
