/**
 * GET /api/leads — list leads (napredan filter, multi-sort, paginacija).
 * POST /api/leads — create lead (manual).
 */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, qpInt } from "../../lib/api";
import { and, eq, sql, asc, desc } from "drizzle-orm";
import { z } from "zod";
import { dedupKey, normalizePhoneE164, normalizeWebsite } from "../../lib/dedup";
import { logAudit } from "../../lib/audit";
import {
  parseSort,
  parseFilters,
  buildWhere,
  buildOrderBy,
} from "../../lib/leads-query";

export const GET: APIRoute = async ({ url }) => {
  const db = getDb();
  const filters = parseFilters(url.searchParams);
  const where = buildWhere(filters);
  const sorts = parseSort(url.searchParams.get("sort"));
  const orderBy = buildOrderBy(sorts);
  const page = qpInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(qpInt(url.searchParams.get("pageSize"), 100), 500);
  const offset = (page - 1) * pageSize;

  const baseSelect = db
    .select({
      // Lead
      id: schema.leads.id,
      name: schema.leads.name,
      category: schema.leads.category,
      phoneRaw: schema.leads.phoneRaw,
      phoneE164: schema.leads.phoneE164,
      email: schema.leads.email,
      websiteRaw: schema.leads.websiteRaw,
      websiteNormalized: schema.leads.websiteNormalized,
      address: schema.leads.address,
      city: schema.leads.city,
      postalCode: schema.leads.postalCode,
      googleRating: schema.leads.googleRating,
      reviewsCount: schema.leads.reviewsCount,
      source: schema.leads.source,
      sourceUrl: schema.leads.sourceUrl,
      lat: schema.leads.lat,
      lng: schema.leads.lng,
      statusId: schema.leads.statusId,
      doNotContact: schema.leads.doNotContact,
      dedupKey: schema.leads.dedupKey,
      importedAt: schema.leads.importedAt,
      importBatchId: schema.leads.importBatchId,
      createdAt: schema.leads.createdAt,
      updatedAt: schema.leads.updatedAt,
      campaignId: schema.leads.campaignId,
      // Joins
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      campaignName: schema.campaigns.name,
      hasScreenshot: sql<number>`CASE WHEN EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id}) THEN 1 ELSE 0 END`,
      // Subqueries (isti izrazi kao u WHERE/order)
      m3Overall: sql<number | null>`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      m3Seo: sql<number | null>`(SELECT seo_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      m3Visual: sql<number | null>`(SELECT visual_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      lastEmailStatus: sql<string | null>`(SELECT status FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1)`,
      lastEmailAt: sql<number | null>`(SELECT COALESCE(email_sends.sent_at, email_sends.queued_at) FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1)`,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.statuses.id, schema.leads.statusId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(where);

  const rows = orderBy.length > 0
    ? baseSelect.orderBy(...orderBy).limit(pageSize).offset(offset).all()
    : baseSelect.orderBy(desc(schema.leads.createdAt)).limit(pageSize).offset(offset).all();

  const total = Number(
    db.select({ c: sql<number>`count(*)` }).from(schema.leads).where(where).all()[0]?.c ?? 0,
  );

  // Distinct gradovi + kategorije (za filter dropdown-e)
  const cities = db
    .select({ city: schema.leads.city })
    .from(schema.leads)
    .where(sql`${schema.leads.city} IS NOT NULL`)
    .groupBy(schema.leads.city)
    .orderBy(asc(schema.leads.city))
    .all()
    .map((r) => r.city)
    .filter(Boolean) as string[];

  const categories = db
    .select({ category: schema.leads.category })
    .from(schema.leads)
    .where(sql`${schema.leads.category} IS NOT NULL`)
    .groupBy(schema.leads.category)
    .orderBy(asc(schema.leads.category))
    .all()
    .map((r) => r.category)
    .filter(Boolean) as string[];

  return ok({
    items: rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    sort: sorts,
    cities,
    categories,
  });
};

const createSchema = z.object({
  name: z.string().min(1),
  campaignId: z.number().int().positive(),
  category: z.string().optional().nullable(),
  phoneRaw: z.string().optional().nullable(),
  email: z
    .string()
    .optional()
    .nullable()
    .refine((v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), "Neispravan email"),
  websiteRaw: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().min(1),
  postalCode: z.string().optional().nullable(),
  googleRating: z.number().min(1).max(5).optional().nullable(),
  reviewsCount: z.number().int().nonnegative().optional().nullable(),
  source: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
});

export const POST: APIRoute = async ({ request }) => {
  const body = await request.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  }
  const data = parsed.data;
  const db = getDb();

  const [campaign] = db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, data.campaignId))
    .all();
  if (!campaign) return bad("Kampanja ne postoji");

  const phoneE164 = normalizePhoneE164(data.phoneRaw);
  const websiteNormalized = normalizeWebsite(data.websiteRaw);
  const key = dedupKey({ website: websiteNormalized, phoneE164, name: data.name, city: data.city });

  const [existing] = db
    .select({ id: schema.leads.id, name: schema.leads.name })
    .from(schema.leads)
    .where(eq(schema.leads.dedupKey, key))
    .all();
  if (existing) {
    return new Response(
      JSON.stringify({ error: "Već postoji lead sa istim podacima", existingId: existing.id, existingName: existing.name }),
      { status: 409, headers: { "Content-Type": "application/json" } },
    );
  }

  const [noviStatus] = db
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(eq(schema.statuses.systemDefault, true))
    .orderBy(asc(schema.statuses.sortOrder))
    .all();

  const [created] = db
    .insert(schema.leads)
    .values({
      name: data.name,
      campaignId: data.campaignId,
      category: data.category ?? null,
      phoneRaw: data.phoneRaw ?? null,
      phoneE164,
      email: data.email ?? null,
      websiteRaw: data.websiteRaw ?? null,
      websiteNormalized,
      address: data.address ?? null,
      city: data.city,
      postalCode: data.postalCode ?? null,
      googleRating: data.googleRating ?? null,
      reviewsCount: data.reviewsCount ?? null,
      source: data.source ?? "manual",
      sourceUrl: data.sourceUrl ?? null,
      statusId: noviStatus?.id ?? null,
      dedupKey: key,
    })
    .returning()
    .all();

  if (created) {
    logAudit("lead.create", "lead", created.id, { name: created.name, campaignId: created.campaignId });
  }
  return ok(created, 201);
};