/**
 * POST /api/site-audit/[leadId]/run — kick off a site audit (async).
 *
 * Proxies to the Python scraper service (POST /audit/{leadId}). Scraper
 * returns immediately with `{job_id, status: "running"}` and runs the audit
 * in a background thread. Real-time progress comes via polling:
 *     GET /api/site-audit/status/[jobId]
 *
 * Why async? Audit lasts 30–90s (re-fetch HTML + 5 phase analyses + MiniMax
 * vision call). With sync API the browser waited indefinitely; with async +
 * polling, the GUI shows the REAL current phase from the backend instead of
 * cycling fake messages.
 */
import type { APIRoute } from "astro";
import { ok, bad, notFound } from "../../../../lib/api";
import { getDb, schema } from "../../../../lib/api";
import { eq } from "drizzle-orm";

export const POST: APIRoute = async ({ params }) => {
  const leadId = Number(params.leadId);
  if (!leadId) return notFound("leadId obavezan");

  // Lead must exist + have a website
  const db = getDb();
  const [lead] = db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.id, leadId))
    .all();
  if (!lead) return notFound("Lead ne postoji");
  if (!lead.websiteNormalized) return bad("Lead nema website — ne može se audittirati");

  const scraperUrl = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    const r = await fetch(`${scraperUrl}/audit/${leadId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Scraper returns {job_id, status: "running"} odmah — ne čeka 90s.
      signal: AbortSignal.timeout(15_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      // Poseban slučaj: scraper vrati {"error": "no successful scrape..."} sa 404
      // — to je KORISNIČKI VALIDAN razlog (treba prvo scrape), prosleđuj dalje.
      try {
        const j = JSON.parse(t);
        if (j && j.error) {
          return new Response(JSON.stringify({ error: j.error }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }
      } catch {
        // t wasn't JSON, fall through
      }
      return bad(`Scraper greška: ${r.status} ${t}`);
    }
    const data = await r.json();
    // Scraper returns {job_id, lead_id, status}
    return ok(data);
  } catch (e) {
    const msg = (e as Error).message || String(e);
    if (/abort|timeout/i.test(msg)) {
      return bad("Scraper nije odgovorio na pokretanje audita (timeout).");
    }
    return bad(`Scraper nedostupan: ${msg}`);
  }
};