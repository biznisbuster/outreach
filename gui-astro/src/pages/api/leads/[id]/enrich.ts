/**
 * POST /api/leads/[id]/enrich — proxy ka scraper-leads /enrich-lead.
 * Google Maps fuzzy lookup, popunjava googleRating/reviewsCount/address.
 */
import type { APIRoute } from "astro";
import { ok, bad, notFound, getDb, schema } from "../../../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all();
  if (!lead) return notFound("Lead ne postoji");

  const url = process.env.SCRAPER_LEADS_URL ?? "http://127.0.0.1:8002";
  try {
    const r = await fetch(`${url}/enrich-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: id,
        name: lead.name,
        city: lead.city,
        category: lead.category,
        address: lead.address,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      return bad(`Scraper-leads greška: ${r.status} ${t}`);
    }
    const data = (await r.json()) as {
      google_rating?: number | null;
      reviews_count?: number | null;
      address?: string | null;
      match?: { name?: string; url?: string } | null;
    };
    db.update(schema.leads)
      .set({
        googleRating: data.google_rating ?? null,
        reviewsCount: data.reviews_count ?? null,
        address: data.address ?? lead.address,
        updatedAt: new Date(),
      })
      .where(eq(schema.leads.id, id))
      .run();
    return ok({ ok: true, ...data });
  } catch (e) {
    return bad(`Scraper-leads nedostupan: ${(e as Error).message}`);
  }
};
