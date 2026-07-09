/** GET /api/scrape-leads/changelog — proxy. */
import type { APIRoute } from "astro";
export const GET: APIRoute = async () => {
  const url = process.env.SCRAPER_LEADS_URL ?? "http://127.0.0.1:8002";
  try {
    const r = await fetch(`${url}/scrape-leads/changelog`, { signal: AbortSignal.timeout(15_000) });
    const text = await r.text();
    return new Response(text, { status: r.status, headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: `Scraper-leads nedostupan: ${(e as Error).message}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }
};
