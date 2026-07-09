/** GET /api/queue — list email_sends (filter by status, lead, sender). */
import type { APIRoute } from "astro";
import { getDb, schema, ok, qpInt } from "../../lib/api";
import { and, eq, desc, sql, inArray } from "drizzle-orm";

export const GET: APIRoute = async ({ url }) => {
  const status = url.searchParams.get("status");
  const limit = Math.min(qpInt(url.searchParams.get("limit"), 100), 500);
  const db = getDb();

  const conds = [];
  if (status) {
    if (status === "open") {
      conds.push(inArray(schema.emailSends.status, ["draft", "queued", "sending"]));
    } else if (status === "all") {
      // no filter
    } else {
      conds.push(eq(schema.emailSends.status, status));
    }
  } else {
    conds.push(inArray(schema.emailSends.status, ["draft", "queued", "sending"]));
  }

  const items = db
    .select({
      emailSend: schema.emailSends,
      leadName: schema.leads.name,
      leadEmail: schema.leads.email,
      campaignName: schema.campaigns.name,
      senderEmail: schema.senders.email,
    })
    .from(schema.emailSends)
    .leftJoin(schema.leads, eq(schema.leads.id, schema.emailSends.leadId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .leftJoin(schema.senders, eq(schema.senders.id, schema.emailSends.senderId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(schema.emailSends.queuedAt), desc(schema.emailSends.id))
    .limit(limit)
    .all();

  // Sažmi brojače po statusu
  const counts = db
    .select({ status: schema.emailSends.status, n: sql<number>`count(*)` })
    .from(schema.emailSends)
    .groupBy(schema.emailSends.status)
    .all();
  return ok({ items, counts });
};
