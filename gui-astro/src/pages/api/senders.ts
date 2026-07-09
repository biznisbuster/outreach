/** GET / POST /api/senders. */
import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../lib/api";
import { desc } from "drizzle-orm";
import { encrypt } from "../../lib/crypto";
import { getSettingInt } from "../../lib/settings";
import { z } from "zod";

export const GET: APIRoute = async () => {
  const db = getDb();
  const rows = db
    .select({
      id: schema.senders.id,
      email: schema.senders.email,
      fromName: schema.senders.fromName,
      smtpHost: schema.senders.smtpHost,
      smtpPort: schema.senders.smtpPort,
      username: schema.senders.username,
      passwordEncrypted: schema.senders.passwordEncrypted,
      dailyCap: schema.senders.dailyCap,
      hourlyCap: schema.senders.hourlyCap,
      minDelaySec: schema.senders.minDelaySec,
      maxDelaySec: schema.senders.maxDelaySec,
      active: schema.senders.active,
      lastUsedAt: schema.senders.lastUsedAt,
    })
    .from(schema.senders)
    .orderBy(desc(schema.senders.id))
    .all();
  const masked = rows.map((r) => ({ ...r, passwordMasked: "••••••••" }));
  return ok(masked);
};

const createSchema = z.object({
  email: z.string().email(),
  fromName: z.string().min(1),
  smtpHost: z.string().min(1),
  smtpPort: z.number().int().min(1).default(465),
  username: z.string().min(1),
  password: z.string().min(1),
  dailyCap: z.number().int().min(1).default(getSettingInt("default_sender_daily_cap") || 50),
  hourlyCap: z.number().int().min(1).default(getSettingInt("default_sender_hourly_cap") || 10),
  minDelaySec: z.number().int().min(0).default(getSettingInt("default_min_delay_sec") || 30),
  maxDelaySec: z.number().int().min(0).default(getSettingInt("default_max_delay_sec") || 120),
  active: z.boolean().default(true),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");
  const db = getDb();
  const passwordEncrypted = encrypt(parsed.data.password);
  const [created] = db
    .insert(schema.senders)
    .values({
      email: parsed.data.email,
      fromName: parsed.data.fromName,
      smtpHost: parsed.data.smtpHost,
      smtpPort: parsed.data.smtpPort,
      username: parsed.data.username,
      passwordEncrypted,
      dailyCap: parsed.data.dailyCap,
      hourlyCap: parsed.data.hourlyCap,
      minDelaySec: parsed.data.minDelaySec,
      maxDelaySec: parsed.data.maxDelaySec,
      active: parsed.data.active,
    })
    .returning()
    .all();
  return ok(created, 201);
};
