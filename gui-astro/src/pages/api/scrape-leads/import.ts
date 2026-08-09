/** POST /api/scrape-leads/import — uvezi CSV iz scraper-leads job-a. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../../lib/api";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { dedupKey, normalizePhoneE164, normalizeWebsite } from "../../../lib/dedup";

const SCRAPER_LEADS_URL = process.env.SCRAPER_LEADS_URL || "http://127.0.0.1:8002";

const importSchema = z.object({
  jobId: z.string().min(1),
  campaignId: z.number().int().positive(),
  force: z.boolean().optional().default(false), // force=true: preskoči dedup, ubaci kao nove
  rows: z
    .array(
      z.object({
        name: z.string(),
        address: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        country: z.string().nullable().optional(),
        phone_e164: z.string().nullable().optional(),
        phone_raw: z.string().nullable().optional(),
        website: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        category: z.string().nullable().optional(),
        rating: z.coerce.number().nullable().optional(),
        reviews_count: z.coerce.number().nullable().optional(),
        latitude: z.coerce.number().nullable().optional(),
        longitude: z.coerce.number().nullable().optional(),
        google_place_id: z.string().nullable().optional(),
        google_maps_url: z.string().nullable().optional(),
        source: z.string().nullable().optional(),
      }),
    )
    .min(1),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = importSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const { jobId, campaignId, rows, force } = parsed.data;

  try {
    const r = await fetch(`${SCRAPER_LEADS_URL}/scrape-leads/status/${jobId}`, { cache: "no-store" });
    if (r.ok) {
      const j = (await r.json()) as { status?: string };
      if (j.status && j.status !== "done") return bad(`Job ${jobId} nije završen (status=${j.status})`);
    }
  } catch {
    // scraper unavailable — propusti verifikaciju
  }

  const db = getDb();
  const [campaign] = db
    .select({ id: schema.campaigns.id })
    .from(schema.campaigns)
    .where(eq(schema.campaigns.id, campaignId))
    .all();
  if (!campaign) return bad("Kampanja ne postoji");

  const [noviStatus] = db
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(eq(schema.statuses.systemDefault, true))
    .orderBy(asc(schema.statuses.sortOrder))
    .all();

  let created = 0;
  let updated = 0;
  let duplicates = 0;
  let skipped = 0;
  const createdIds: number[] = [];
  const updatedIds: number[] = [];
  // Detaljan breakdown za UI — korisnik vidi TAČNO koji su duplikati i gde već postoje.
  const duplicateDetails: Array<{
    name: string;
    reason: "web" | "phone" | "ime_grad";
    matchValue: string;
    existingId: number;
    existingCampaignId: number;
    existingCampaignName: string | null;
    existingCity: string | null;
  }> = [];
  const skippedDetails: Array<{ reason: string; name: string }> = [];

  for (const row of rows) {
    if (!row.name || !row.name.trim()) {
      skipped++;
      skippedDetails.push({ reason: "prazno_ime", name: row.name ?? "" });
      continue;
    }

    const phoneE164 = normalizePhoneE164(row.phone_e164 || row.phone_raw);
    const websiteNormalized = normalizeWebsite(row.website);
    const baseKey = dedupKey({
      website: websiteNormalized,
      phoneE164,
      name: row.name,
      city: row.city ?? null,
    });

    // Ako je force=true, preskačemo dedup proveru i pravimo NOVI unique key
    // (sa UUID suffixom) da ne pukne unique index.
    const key = force ? `force:${baseKey}:${crypto.randomUUID().slice(0, 8)}` : baseKey;

    // U force modu, preskačemo i merge logiku (updated nema smisla)
    if (!force) {
      const [existing] = db
        .select({
          id: schema.leads.id,
          reviewsCount: schema.leads.reviewsCount,
          googleRating: schema.leads.googleRating,
          sourceUrl: schema.leads.sourceUrl,
          phoneE164: schema.leads.phoneE164,
          campaignId: schema.leads.campaignId,
          city: schema.leads.city,
        })
        .from(schema.leads)
        .where(eq(schema.leads.dedupKey, key))
        .all();

      let existingByPhone:
        | { id: number; reviewsCount: number | null; googleRating: number | null; sourceUrl: string | null; campaignId: number; city: string | null }
        | undefined;
      if (!existing && phoneE164) {
        const [byPhone] = db
          .select({
            id: schema.leads.id,
            reviewsCount: schema.leads.reviewsCount,
            googleRating: schema.leads.googleRating,
            sourceUrl: schema.leads.sourceUrl,
            campaignId: schema.leads.campaignId,
            city: schema.leads.city,
          })
          .from(schema.leads)
          .where(eq(schema.leads.phoneE164, phoneE164))
          .all();
        existingByPhone = byPhone;
      }

      let existingRow:
        | { id: number; reviewsCount: number | null; googleRating: number | null; sourceUrl: string | null; campaignId: number; city: string | null; matchReason: "web" | "phone" | "ime_grad" }
        | null = null;
      if (existing) {
        existingRow = { ...existing, matchReason: websiteNormalized ? "web" : (phoneE164 ? "phone" : "ime_grad") };
      } else if (existingByPhone) {
        existingRow = { ...existingByPhone, matchReason: "phone" };
      }

      if (existingRow) {
        // Učitaj ime kampanje za breakdown
        const [camp] = db
          .select({ name: schema.campaigns.name })
          .from(schema.campaigns)
          .where(eq(schema.campaigns.id, existingRow.campaignId))
          .all();

        const updates: Record<string, unknown> = {};
        if (row.reviews_count != null && (existingRow.reviewsCount == null || existingRow.reviewsCount === 0)) {
          updates.reviewsCount = row.reviews_count;
        }
        if (row.rating != null && existingRow.googleRating == null) {
          updates.googleRating = row.rating;
        }
        if (row.google_maps_url && !existingRow.sourceUrl) {
          updates.sourceUrl = row.google_maps_url;
        }
        if (Object.keys(updates).length > 0) {
          db.update(schema.leads).set(updates).where(eq(schema.leads.id, existingRow.id)).run();
          updatedIds.push(existingRow.id);
          updated++;
        } else {
          duplicates++;
        }
        const matchVal =
          existingRow.matchReason === "web" ? (websiteNormalized || "")
          : existingRow.matchReason === "phone" ? (phoneE164 || "")
          : `${row.name}|${row.city ?? ""}`;
        duplicateDetails.push({
          name: row.name,
          reason: existingRow.matchReason,
          matchValue: matchVal,
          existingId: existingRow.id,
          existingCampaignId: existingRow.campaignId,
          existingCampaignName: camp?.name ?? null,
          existingCity: existingRow.city,
        });
        continue;
      }
    }

    // U force modu, preskačemo i PhoneE164 unique check — i dalje ćemo pokušati insert
    // sa novim ključem. Ako postoji unique constraint i na phone_e164, ignorišemo grešku
    // (to se ne može desiti jer phone_e164 nema unique index u bazi).
    try {
      const [ins] = db
        .insert(schema.leads)
        .values({
          campaignId,
          name: row.name.trim(),
          category: row.category ?? null,
          phoneRaw: row.phone_raw ?? null,
          phoneE164,
          email: row.email ?? null,
          websiteRaw: row.website ?? null,
          websiteNormalized,
          address: row.address ?? null,
          city: row.city ?? null,
          googleRating: row.rating ?? null,
          reviewsCount: row.reviews_count ?? null,
          source: row.source ?? "maps",
          sourceUrl: row.google_maps_url ?? null,
          statusId: noviStatus?.id ?? null,
          dedupKey: key,
        })
        .returning({ id: schema.leads.id })
        .all();

      if (ins) {
        created++;
        createdIds.push(ins.id);
      }
    } catch (insErr) {
      // Unique constraint (dedup_key) ili bilo koja druga greška za ovaj red —
      // NE ruši ceo batch. Brojimo kao duplikat i nastavljamo dalje da ostali
      // leadovi ne ostanu neuvezeni zbog jednog problematičnog reda.
      duplicates++;
      duplicateDetails.push({
        name: row.name,
        reason: "web",
        matchValue: key,
        existingId: 0,
        existingCampaignId: campaignId,
        existingCampaignName: null,
        existingCity: row.city ?? null,
      });
    }
  }

  return ok({
    created,
    updated,
    duplicates,
    skipped,
    createdIds,
    updatedIds,
    duplicateDetails,
    skippedDetails,
    campaignId,
    force: !!force,
  });
};
