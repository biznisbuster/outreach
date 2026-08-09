"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/core/db";

export async function saveTemplate(formData: FormData) {
  const idRaw = formData.get("id");
  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "email_personalization");
  const body = String(formData.get("body") ?? "").trim();
  if (!name || !body) return;

  const db = getDb();
  if (idRaw) {
    db.update(schema.promptTemplates)
      .set({ name, type, body, updatedAt: new Date() })
      .where(eq(schema.promptTemplates.id, Number(idRaw)))
      .run();
  } else {
    db.insert(schema.promptTemplates).values({ name, type, body }).run();
  }
  revalidatePath("/templates");
}

export async function deleteTemplate(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  db.delete(schema.promptTemplates).where(eq(schema.promptTemplates.id, id)).run();
  revalidatePath("/templates");
}
