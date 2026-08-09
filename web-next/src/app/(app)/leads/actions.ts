"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/core/db";
import { normalizePhoneE164, normalizeWebsite, dedupKey } from "@/core/dedup";
import { logAudit } from "@/core/audit";

export async function createLead(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  const campaignId = Number(formData.get("campaignId") ?? 0);
  const category = String(formData.get("category") ?? "").trim() || null;
  const phoneRaw = String(formData.get("phoneRaw") ?? "").trim() || null;
  const email = String(formData.get("email") ?? "").trim() || null;
  const websiteRaw = String(formData.get("websiteRaw") ?? "").trim() || null;
  const address = String(formData.get("address") ?? "").trim() || null;

  if (!name || !city || !campaignId) {
    redirect("/leads?error=Naziv,+grad+i+kampanja+su+obavezni");
  }

  const db = getDb();
  const phoneE164 = normalizePhoneE164(phoneRaw);
  const websiteNormalized = normalizeWebsite(websiteRaw);
  const key = dedupKey({ website: websiteNormalized, phoneE164, name, city });

  const existing = db
    .select({ id: schema.leads.id, name: schema.leads.name })
    .from(schema.leads)
    .where(eq(schema.leads.dedupKey, key))
    .get();
  if (existing) {
    redirect(`/leads?error=${encodeURIComponent(`Već postoji: ${existing.name}`)}`);
  }

  const [created] = db
    .insert(schema.leads)
    .values({
      campaignId,
      name,
      category,
      city,
      phoneRaw,
      phoneE164,
      email,
      websiteRaw,
      websiteNormalized,
      address,
      dedupKey: key,
      source: "manual",
    })
    .returning()
    .all();

  logAudit("lead.create", "lead", created?.id, { name });
  revalidatePath("/leads");
  if (created) redirect(`/leads/${created.id}`);
}
