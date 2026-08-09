/**
 * GET /api/site-audit/status/[jobId] — proxy ka scraper status endpoint-u.
 *
 * GUI poll-uje ovaj endpoint svakih ~1.5s dok audit traje. Vraća:
 *   {
 *     job_id, lead_id, status (running|done|error),
 *     current_phase (string), phase_index (int 0-4),
 *     total_phases (5), phase_message (string),
 *     elapsed_sec, error, overall_rank, audit_id
 *   }
 */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../../lib/api";

export const GET: APIRoute = async ({ params }) => {
  const jobId = params.jobId;
  if (!jobId) return bad("jobId obavezan");

  const scraperUrl = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    const r = await fetch(`${scraperUrl}/audit/status/${encodeURIComponent(jobId)}`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      // 404 = job not found (server restart, ili pogrešan jobId).
      // Forward sa statusom 404 da GUI zna da prestane sa pollingom.
      return new Response(
        JSON.stringify({ error: t || "audit job not found (scraper restarted?)" }),
        { status: 404, headers: { "Content-Type": "application/json" } },
      );
    }
    const data = await r.json();
    return ok(data);
  } catch (e) {
    return bad(`Scraper status nedostupan: ${(e as Error).message}`);
  }
};