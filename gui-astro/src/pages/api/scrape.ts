/** POST /api/scrape — pokreni crawl + screenshot za lead. Proxy ka port 8001. */
import type { APIRoute } from "astro";
import { ok, bad, getDb, schema } from "../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as { leadId?: number; maxPages?: number };
  const leadId = Number(body.leadId);
  if (!leadId) return bad("leadId je obavezan");

  const db = getDb();
  const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).all();
  if (!lead) return bad("Lead ne postoji");

  const url = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    const r = await fetch(`${url}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead_id: leadId,
        max_pages: body.maxPages ?? 20,
        website: lead.websiteNormalized,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      return bad(`Scraper greška: ${r.status} ${t}`);
    }
    const data = (await r.json()) as { job_id?: string; jobId?: string };
    return ok({ jobId: data.job_id ?? data.jobId });
  } catch (e) {
    return bad(`Scraper nedostupan: ${(e as Error).message}`);
  }
};
