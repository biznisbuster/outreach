/** GET /api/campaigns — list. POST — create. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../lib/api";
import { eq, sql, desc, asc, and } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../lib/audit";

export const GET: APIRoute = async () => {
  const db = getDb();
  const items = db
    .select({
      campaign: schema.campaigns,
      leadCount: sql<number>`(SELECT COUNT(*) FROM leads WHERE campaign_id = ${schema.campaigns.id})`,
    })
    .from(schema.campaigns)
    .orderBy(desc(schema.campaigns.createdAt))
    .all();
  return ok({ items });
};

const createSchema = z.object({
  name: z.string().min(1),
  category: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
});

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const [created] = db.insert(schema.campaigns).values(parsed.data).returning().all();
  if (created) logAudit("campaign.create", "campaign", created.id, { name: created.name });
  return ok(created, 201);
};
