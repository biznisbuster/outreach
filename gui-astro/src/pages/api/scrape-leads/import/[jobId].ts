/** POST /api/scrape-leads/import/[jobId] — proxy; vraća CSV/JSON iz scraper-leads.

VAŽNO: scraper-leads endpoint je POST (ne GET). Stari GET proxy je vraćao 405
"Method Not Allowed" pa je ScrapePanel prikazivao "Nema rezultata za uvoz"
iako je job imao redove na disku.
 */
import type { APIRoute } from "astro";

export const POST: APIRoute = async ({ params }) => {
  const url = process.env.SCRAPER_LEADS_URL ?? "http://127.0.0.1:8002";
  try {
    const r = await fetch(`${url}/scrape-leads/import/${params.jobId}`, {
      method: "POST",
      signal: AbortSignal.timeout(15_000),
    });
    const text = await r.text();
    return new Response(text, {
      status: r.status,
      headers: { "Content-Type": r.headers.get("Content-Type") ?? "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: `Scraper-leads nedostupan: ${(e as Error).message}` }),
      { status: 502, headers: { "Content-Type": "application/json" } },
    );
  }
};

// GET je izložen samo kao health probe — pozivatelji MORAJU koristiti POST.
// Vraćamo 405 sa korisnom porukom umesto da tiho ne radimo ništa.
export const GET: APIRoute = async () => {
  return new Response(
    JSON.stringify({
      error: "Method Not Allowed — koristi POST. Ovaj endpoint dohvata CSV/JSON redove iz scraper-leads job-a i zahteva POST jer je tako definisan u FastAPI-ju.",
    }),
    { status: 405, headers: { "Content-Type": "application/json", Allow: "POST" } },
  );
};
