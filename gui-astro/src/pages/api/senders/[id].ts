/** PATCH / DELETE / POST /api/senders/[id]. POST = test send. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, notFound } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { encrypt } from "../../../lib/crypto";
import { decrypt } from "../../../lib/crypto";
import { getTransporter } from "../../../lib/email/sender";
import nodemailer from "nodemailer";

const patchSchema = z.object({
  email: z.string().email().optional(),
  fromName: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.number().int().min(1).optional(),
  username: z.string().optional(),
  password: z.string().optional(),
  dailyCap: z.number().int().min(1).optional(),
  hourlyCap: z.number().int().min(1).optional(),
  minDelaySec: z.number().int().min(0).optional(),
  maxDelaySec: z.number().int().min(0).optional(),
  active: z.boolean().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const data = parsed.data;
  if (data.password) {
    (data as Record<string, unknown>).passwordEncrypted = encrypt(data.password);
    delete (data as Record<string, unknown>).password;
  }
  const db = getDb();
  const [updated] = db.update(schema.senders).set(data).where(eq(schema.senders.id, id)).returning().all();
  if (!updated) return notFound();
  return ok(updated);
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.senders).where(eq(schema.senders.id, id)).run();
  return ok({ ok: true });
};

const testSchema = z.object({
  testEmail: z.string().email(),
});

export const POST: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = testSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");

  const db = getDb();
  const [sender] = db.select().from(schema.senders).where(eq(schema.senders.id, id)).all();
  if (!sender) return notFound();

  const password = decrypt(sender.passwordEncrypted);
  const transporter = getTransporter(sender.smtpHost, sender.smtpPort, sender.username, password);
  try {
    const info = await transporter.sendMail({
      from: `"${sender.fromName}" <${sender.email}>`,
      to: parsed.data.testEmail,
      subject: "Outreach test email",
      text: "Ako čitaš ovo, SMTP radi.",
    });
    return ok({ ok: true, messageId: info.messageId });
  } catch (e) {
    return bad(`SMTP greška: ${(e as Error).message}`, 502);
  }
};

// Avoid unused import warning
void nodemailer;
