/**
 * POST /api/site-audit/[leadId]/run — kick off a site audit.
 *
 * Proxies to the Python scraper service (POST /audit/{leadId}). The scraper
 * does the actual work, persists to site_audits + site_audit_metrics, and
 * returns the full report. We forward that as JSON.
 *
 * The request can take 30s – 90s for sites with 20+ pages; the scraper
 * runs synchronously and only returns when done.
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
      signal: AbortSignal.timeout(180_000), // 3 min — audits can be slow
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      return bad(`Scraper greška: ${r.status} ${t}`);
    }
    const data = await r.json();
    return ok(data);
  } catch (e) {
    return bad(`Scraper nedostupan: ${(e as Error).message}`);
  }
};
