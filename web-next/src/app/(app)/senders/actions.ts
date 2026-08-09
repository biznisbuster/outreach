"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, schema } from "@/core/db";
import { encrypt } from "@/core/crypto";

export async function createSender(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  const fromName = String(formData.get("fromName") ?? "").trim();
  const smtpHost = String(formData.get("smtpHost") ?? "").trim();
  const smtpPort = Number(formData.get("smtpPort") ?? 587);
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const dailyCap = Number(formData.get("dailyCap") ?? 50);
  const hourlyCap = Number(formData.get("hourlyCap") ?? 10);

  if (!email || !smtpHost || !username || !password) return;

  const db = getDb();
  db.insert(schema.senders)
    .values({
      email,
      fromName: fromName || email,
      smtpHost,
      smtpPort,
      username,
      passwordEncrypted: encrypt(password),
      dailyCap,
      hourlyCap,
    })
    .run();
  revalidatePath("/senders");
}

export async function toggleSender(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const sender = db.select().from(schema.senders).where(eq(schema.senders.id, id)).get();
  if (!sender) return;
  db.update(schema.senders).set({ active: !sender.active }).where(eq(schema.senders.id, id)).run();
  revalidatePath("/senders");
}

export async function deleteSender(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  db.delete(schema.senders).where(eq(schema.senders.id, id)).run();
  revalidatePath("/senders");
}
