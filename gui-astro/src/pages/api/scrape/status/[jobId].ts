/** GET /api/scrape/status/[jobId] — status job-a (proxy). */
import type { APIRoute } from "astro";
export const GET: APIRoute = async ({ params }) => {
  const url = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    const r = await fetch(`${url}/scrape/status/${params.jobId}`, { signal: AbortSignal.timeout(30_000) });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Scraper nedostupan: ${(e as Error).message}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
