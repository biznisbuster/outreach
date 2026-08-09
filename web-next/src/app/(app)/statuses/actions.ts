"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/core/db";

export async function createStatus(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const color = String(formData.get("color") ?? "#6b7280");
  if (!name) return;

  const db = getDb();
  const last = db.select().from(schema.statuses).all();
  const maxOrder = last.reduce((m, s) => Math.max(m, s.sortOrder), 0);
  db.insert(schema.statuses).values({ name, color, sortOrder: maxOrder + 1 }).run();
  revalidatePath("/statuses");
}

export async function deleteStatus(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const st = db.select().from(schema.statuses).where(eq(schema.statuses.id, id)).get();
  if (st?.systemDefault) return;
  db.update(schema.leads).set({ statusId: null }).where(eq(schema.leads.statusId, id)).run();
  db.delete(schema.statuses).where(eq(schema.statuses.id, id)).run();
  revalidatePath("/statuses");
}
