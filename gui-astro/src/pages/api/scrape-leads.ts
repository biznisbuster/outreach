/** POST /api/scrape-leads — pokreni Google Maps job (proxy ka 8002).

Prihvata dva moda:
  - novi: { query: "cvecare beograd" }   ← ceo string ide kao search prompt
  - stari: { category: "x", city: "y" } ← nazad-kompatibilno
Ako je prosleđen i query i category/city, query ima prioritet.
 */
import type { APIRoute } from "astro";
import { ok, bad } from "../../lib/api";

export const POST: APIRoute = async ({ request }) => {
  const body = (await request.json().catch(() => ({}))) as {
    query?: string;
    category?: string;
    city?: string;
    country?: string;
    language?: string;
    max_results?: number;
    extract_emails?: boolean;
  };

  const query = (body.query ?? "").trim();
  const category = (body.category ?? "").trim();
  const city = (body.city ?? "").trim();

  // Validacija: mora query ILI (category + city)
  if (!query && (!category || !city)) {
    return bad("Potrebno je 'query' ILI ('category' i 'city')");
  }

  const url = process.env.SCRAPER_LEADS_URL ?? "http://127.0.0.1:8002";
  try {
    const payload: Record<string, unknown> = {
      country: (body.country ?? "RS").toUpperCase(),
      language: body.language ?? "sr",
      max_results: body.max_results ?? 25,
      extract_emails: body.extract_emails ?? true,
      stealth: "lite",
    };
    if (query) {
      // query ima prioritet — category/city se ignorišu
      payload.query = query;
    } else {
      payload.category = category;
      payload.city = city;
    }

    const r = await fetch(`${url}/scrape-leads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(60_000),
    });
    if (!r.ok) {
      const t = await r.text().catch(() => r.statusText);
      return bad(`Scraper-leads greška: ${r.status} ${t}`);
    }
    const data = (await r.json()) as { job_id?: string; jobId?: string };
    return ok({ jobId: data.job_id ?? data.jobId });
  } catch (e) {
    return bad(`Scraper-leads nedostupan: ${(e as Error).message}`);
  }
};
