"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/core/db";
import { logAudit } from "@/core/audit";

export async function createCampaign(formData: FormData) {
  const category = String(formData.get("category") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();
  if (!category || !city) return;

  const name = `${category} — ${city}`;
  const db = getDb();
  const [created] = db
    .insert(schema.campaigns)
    .values({ name, category, city })
    .returning()
    .all();
  logAudit("campaign.create", "campaign", created?.id, { name });
  revalidatePath("/campaigns");
  if (created) redirect(`/campaigns/${created.id}`);
}
