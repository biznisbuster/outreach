/** POST /api/leads/create — form action used by the "Dodaj klijenta" modal on /leads.
 *
 * Body: name*, city*, campaignId*, category?, phoneRaw?, email?, websiteRaw?, address?, postalCode?, googleRating?, reviewsCount?, source?
 *
 * Returns 303 redirect on success/failure (form-friendly):
 *   - success: /leads/{id}     (redirect → Toaster fires a "Lead kreiran" toast on the lead detail page)
 *   - error:   /leads?error=... (Toaster on /leads page reads it)
 *
 * NOTE: This used to live in src/pages/leads/new.astro (which is now deleted).
 * All behavior — validation, dedup, audit, default status — is byte-identical.
 */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { eq, asc } from "drizzle-orm";
import { z } from "zod";
import { normalizePhoneE164, normalizeWebsite, dedupKey } from "../../../lib/dedup";
import { logAudit } from "../../../lib/audit";

const leadSchema = z.object({
  name: z.string().min(1, "Naziv obavezan"),
  campaignId: z.coerce.number().int().positive("Kampanja obavezna"),
  category: z.string().optional().nullable(),
  phoneRaw: z.string().optional().nullable(),
  email: z.string().email("Neispravan email").optional().nullable().or(z.literal("")),
  websiteRaw: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().min(1, "Grad obavezan"),
  postalCode: z.string().optional().nullable(),
  googleRating: z.coerce.number().min(1).max(5).optional().nullable(),
  reviewsCount: z.coerce.number().int().nonnegative().optional().nullable(),
  source: z.string().optional().nullable(),
});

export const POST: APIRoute = async ({ request, redirect }) => {
  const form = await request.formData();
  const data = Object.fromEntries(form.entries());

  const parseResult = leadSchema.safeParse(data);
  if (!parseResult.success) {
    const msg = parseResult.error.issues[0]?.message ?? "Neispravan unos";
    return redirect(`/leads?error=${encodeURIComponent(msg)}`, 303);
  }

  const d = parseResult.data;
  const db = getDb();

  const phoneE164 = normalizePhoneE164(d.phoneRaw);
  const websiteNormalized = normalizeWebsite(d.websiteRaw);
  const key = dedupKey({ website: websiteNormalized, phoneE164, name: d.name, city: d.city });

  // Dedup guard
  const [existing] = db
    .select({ id: schema.leads.id, name: schema.leads.name })
    .from(schema.leads)
    .where(eq(schema.leads.dedupKey, key))
    .all();
  if (existing) {
    return redirect(
      `/leads?error=${encodeURIComponent(`Već postoji: ${existing.name}`)}`,
      303,
    );
  }

  // Default status (systemDefault, lowest sortOrder)
  const [noviStatus] = db
    .select({ id: schema.statuses.id })
    .from(schema.statuses)
    .where(eq(schema.statuses.systemDefault, true))
    .orderBy(asc(schema.statuses.sortOrder))
    .all();

  const [created] = db
    .insert(schema.leads)
    .values({
      name: d.name,
      campaignId: d.campaignId,
      category: d.category ?? null,
      phoneRaw: d.phoneRaw ?? null,
      phoneE164,
      email: d.email || null,
      websiteRaw: d.websiteRaw ?? null,
      websiteNormalized,
      address: d.address ?? null,
      city: d.city,
      postalCode: d.postalCode ?? null,
      googleRating: d.googleRating || null,
      reviewsCount: d.reviewsCount || null,
      source: d.source ?? "manual",
      statusId: noviStatus?.id ?? null,
      dedupKey: key,
    })
    .returning()
    .all();

  if (created) {
    logAudit("lead.create", "lead", created.id, { name: created.name });
    // Lead detail page uses Toaster for ?ok= success messages — fire a confirmation toast.
    return redirect(`/leads/${created.id}?ok=${encodeURIComponent("Lead kreiran: " + created.name)}`, 303);
  }
  return redirect(`/leads?error=${encodeURIComponent("Neuspeh pri kreiranju")}`, 303);
};
