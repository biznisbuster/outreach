/** GET /api/leads/export.csv — CSV export svih leadova (opciono po campaignId). */
import type { APIRoute } from "astro";
import { getDb, schema, bad } from "../../../lib/api";
import { eq } from "drizzle-orm";

function esc(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const GET: APIRoute = async ({ url }) => {
  const campaignId = url.searchParams.get("campaignId");
  const db = getDb();
  const conds = [];
  if (campaignId) conds.push(eq(schema.leads.campaignId, Number(campaignId)));

  const rows = db
    .select({
      lead: schema.leads,
      statusName: schema.statuses.name,
      campaignName: schema.campaigns.name,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.statuses.id, schema.leads.statusId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(conds.length ? conds[0] : undefined)
    .orderBy(schema.leads.id)
    .all();

  const header = [
    "id", "name", "campaign", "status", "category",
    "phone_raw", "phone_e164", "email",
    "website_raw", "website_normalized",
    "address", "city", "postal_code",
    "google_rating", "reviews_count",
    "source", "source_url",
    "do_not_contact", "blocked",
    "created_at", "imported_at",
  ];

  const out = [header.join(",")];
  for (const r of rows) {
    const l = r.lead;
    const createdIso = l.createdAt instanceof Date ? l.createdAt.toISOString() : new Date(Number(l.createdAt) || 0).toISOString();
    const importedIso = l.importedAt instanceof Date ? l.importedAt.toISOString() : (l.importedAt ? new Date(Number(l.importedAt)).toISOString() : "");
    out.push(
      [
        l.id, l.name, r.campaignName ?? "", r.statusName ?? "", l.category ?? "",
        l.phoneRaw ?? "", l.phoneE164 ?? "", l.email ?? "",
        l.websiteRaw ?? "", l.websiteNormalized ?? "",
        l.address ?? "", l.city ?? "", l.postalCode ?? "",
        l.googleRating ?? "", l.reviewsCount ?? "",
        l.source ?? "", l.sourceUrl ?? "",
        l.doNotContact ? 1 : 0, "",
        createdIso, importedIso,
      ].map(esc).join(","),
    );
  }
  const body = "\ufeff" + out.join("\n"); // BOM za Excel UTF-8
  const filename = campaignId ? `leads-campaign-${campaignId}.csv` : "leads.csv";
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
};

void bad;
