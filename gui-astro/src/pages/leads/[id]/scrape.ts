/** POST /leads/[id]/scrape — pokreni scrape + screenshot. */
import type { APIRoute } from "astro";
import { ok, bad, notFound, getDb, schema } from "../../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ params, redirect }) => {
  const id = Number(params.id);
  const db = getDb();
  const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all();
  if (!lead) {
    return redirect(`/leads?error=Lead+ne+postoji`, 303);
  }
  const url = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    const r = await fetch(`${url}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: id, max_pages: 20, website: lead.websiteNormalized }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      return redirect(`/leads/${id}?error=${encodeURIComponent(`Scraper: ${t}`)}`, 303);
    }
    return redirect(`/leads/${id}?ok=Scrape+pokrenut`, 303);
  } catch (e) {
    return redirect(`/leads/${id}?error=${encodeURIComponent(`Scraper nedostupan: ${(e as Error).message}`)}`, 303);
  }
};

// Help TS imports stay even if unused
void ok; void bad; void notFound;
