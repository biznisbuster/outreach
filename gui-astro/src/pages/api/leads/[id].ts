/**
 * GET / PATCH / DELETE /api/leads/[id]
 */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, notFound } from "../../../lib/api";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../../lib/audit";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();

  const [row] = db
    .select({
      lead: schema.leads,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.leads.statusId, schema.statuses.id))
    .where(eq(schema.leads.id, id))
    .all();
  if (!row) return notFound("Lead nije pronađen");

  const comments = db
    .select()
    .from(schema.comments)
    .where(eq(schema.comments.leadId, id))
    .orderBy(desc(schema.comments.createdAt))
    .all();

  const scrapes = db.select().from(schema.siteScrapes).where(eq(schema.siteScrapes.leadId, id)).all();
  const screenshots = db.select().from(schema.screenshots).where(eq(schema.screenshots.leadId, id)).all();
  const emailSends = db
    .select()
    .from(schema.emailSends)
    .where(eq(schema.emailSends.leadId, id))
    .orderBy(desc(schema.emailSends.queuedAt))
    .all();
  const blocked = db.select().from(schema.blocklist).where(eq(schema.blocklist.leadId, id)).limit(1).all();

  return ok({
    ...row.lead,
    statusName: row.statusName,
    statusColor: row.statusColor,
    comments,
    analysis: null, // AI analyze dropped — uvek null u v2
    scrapes,
    screenshots,
    emailSends,
    blocked: blocked.length > 0,
  });
};

const patchSchema = z.object({
  name: z.string().optional(),
  category: z.string().optional().nullable(),
  phoneRaw: z.string().optional().nullable(),
  phoneE164: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  websiteRaw: z.string().optional().nullable(),
  websiteNormalized: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  googleRating: z.number().optional().nullable(),
  reviewsCount: z.number().optional().nullable(),
  source: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  statusId: z.number().optional().nullable(),
  doNotContact: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const body = await request.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");

  const db = getDb();
  // Dohvati prethodni status za audit
  const before = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all()[0];

  const [updated] = db
    .update(schema.leads)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.leads.id, id))
    .returning()
    .all();
  if (!updated) return notFound("Lead nije pronađen");

  if (before && parsed.data.statusId !== undefined && parsed.data.statusId !== before.statusId) {
    logAudit("lead.status_change", "lead", id, { from: before.statusId, to: parsed.data.statusId });
  } else {
    logAudit("lead.update", "lead", id, parsed.data as Record<string, unknown>);
  }
  return ok(updated);
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.leads).where(eq(schema.leads.id, id)).run();
  logAudit("lead.delete", "lead", id);
  return ok({ ok: true });
};
