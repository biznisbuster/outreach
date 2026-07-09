/**
 * GET /api/leads — list leads (filter, paginate).
 * POST /api/leads — create lead (manual).
 */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, qpInt } from "../../lib/api";
import { eq, and, sql, isNull, desc, asc } from "drizzle-orm";
import { z } from "zod";
import { dedupKey, normalizePhoneE164, normalizeWebsite } from "../../lib/dedup";
import { logAudit } from "../../lib/audit";

export const GET: APIRoute = async ({ url }) => {
  const db = getDb();

  const campaignId = url.searchParams.get("campaignId");
  const statusId = url.searchParams.get("statusId");
  const search = url.searchParams.get("search")?.trim();
  const hasEmail = url.searchParams.get("hasEmail");
  const noWebsite = url.searchParams.get("noWebsite");
  const hasPhone = url.searchParams.get("hasPhone");
  const hasScreenshot = url.searchParams.get("hasScreenshot");
  const city = url.searchParams.get("city");
  const dnc = url.searchParams.get("dnc");
  const page = qpInt(url.searchParams.get("page"), 1);
  const pageSize = Math.min(qpInt(url.searchParams.get("pageSize"), 50), 500);
  const sortBy = url.searchParams.get("sortBy") || "createdAt";
  const sortDir = url.searchParams.get("sortDir") === "asc" ? "asc" : "desc";

  const conds: ReturnType<typeof eq>[] = [];
  if (campaignId) conds.push(eq(schema.leads.campaignId, Number(campaignId)));
  if (statusId && statusId !== "null") conds.push(eq(schema.leads.statusId, Number(statusId)));
  if (statusId === "null") conds.push(isNull(schema.leads.statusId));
  if (hasEmail === "1") conds.push(sql`${schema.leads.email} IS NOT NULL AND ${schema.leads.email} != ''`);
  if (noWebsite === "1") conds.push(isNull(schema.leads.websiteNormalized));
  if (hasPhone === "1") conds.push(sql`${schema.leads.phoneE164} IS NOT NULL AND ${schema.leads.phoneE164} != ''`);
  if (hasScreenshot === "1") conds.push(sql`EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id})`);
  if (city) conds.push(eq(schema.leads.city, city));
  if (dnc === "1") conds.push(eq(schema.leads.doNotContact, true));
  if (dnc === "0") conds.push(eq(schema.leads.doNotContact, false));
  if (search) {
    const s = `%${search}%`;
    conds.push(
      sql`(lower(${schema.leads.name}) LIKE lower(${s}) OR lower(coalesce(${schema.leads.email},'')) LIKE lower(${s}) OR lower(coalesce(${schema.leads.websiteNormalized},'')) LIKE lower(${s}) OR lower(coalesce(${schema.leads.city},'')) LIKE lower(${s}))`,
    );
  }

  const where = conds.length ? and(...conds) : undefined;

  const sortCol =
    sortBy === "name"
      ? schema.leads.name
      : sortBy === "googleRating"
        ? schema.leads.googleRating
        : sortBy === "updatedAt"
          ? schema.leads.updatedAt
          : schema.leads.createdAt;
  const orderBy = sortDir === "asc" ? asc(sortCol) : desc(sortCol);

  const offset = (page - 1) * pageSize;
  const rows = db
    .select({
      lead: schema.leads,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      hasScreenshot: sql<number>`CASE WHEN EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id}) THEN 1 ELSE 0 END`,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.leads.statusId, schema.statuses.id))
    .where(where)
    .orderBy(orderBy)
    .limit(pageSize)
    .offset(offset)
    .all();

  const total = Number(
    db.select({ c: sql<number>`count(*)` }).from(schema.leads).where(where).all()[0]?.c ?? 0,
  );

  const cities = db
    .select({ city: schema.leads.city })
    .from(schema.leads)
    .where(sql`${schema.leads.city} IS NOT NULL`)
    .groupBy(schema.leads.city)
    .orderBy(asc(schema.leads.city))
    .all()
    .map((r) => r.city)
    .filter(Boolean) as string[];

  return ok({
    items: rows,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    cities,
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
