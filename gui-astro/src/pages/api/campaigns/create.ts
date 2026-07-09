/** POST /api/campaigns/create — form action.
 *
 * Campaign naming convention: name is auto-derived from category + city
 *   name = `${category} — ${city}`
 *
 * Form fields:
 *   category*  — e.g. "Cvećara" (business type)
 *   city*      — e.g. "Kruševac"
 *
 * Returns 303 redirect on success/failure.
 */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const category = String(form.get("category") ?? "").trim();
  const city = String(form.get("city") ?? "").trim();

  if (!category) {
    return new Response("Kategorija obavezna", { status: 400 });
  }
  if (!city) {
    return new Response("Grad obavezan", { status: 400 });
  }

  const name = `${category} — ${city}`;
  const db = getDb();
  try {
    const [created] = db
      .insert(schema.campaigns)
      .values({ name, category, city })
      .returning()
      .all();
    if (!created) return redirect("/campaigns", 302);
    return redirect(`/campaigns/${created.id}?ok=${encodeURIComponent("Kampanja kreirana")}`, 303);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Greška";
    return redirect(`/campaigns?error=${encodeURIComponent(msg)}`, 303);
  }
};
