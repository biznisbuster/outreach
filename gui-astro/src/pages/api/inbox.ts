/** GET /api/inbox — list email_replies. */
import type { APIRoute } from "astro";
import { getDb, schema, ok } from "../../lib/api";
import { desc, eq } from "drizzle-orm";

export const GET: APIRoute = async () => {
  const db = getDb();
  const rows = db
    .select({
      reply: schema.emailReplies,
      leadName: schema.leads.name,
      campaignName: schema.campaigns.name,
    })
    .from(schema.emailReplies)
    .leftJoin(schema.leads, eq(schema.leads.id, schema.emailReplies.leadId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .orderBy(desc(schema.emailReplies.receivedAt))
    .limit(200)
    .all();
  return ok({ items: rows });
};
