import { getDb, schema } from "@/lib/db";
import { and, eq, sql, gte, asc } from "drizzle-orm";
import { getSetting, getSettingInt } from "@/lib/settings";

/**
 * Parsira vremenski prozor (09:00-17:00 Europe/Belgrade pon-pet) i proverava da li je trenutno vreme unutar prozora.
 */
export function isWithinSendWindow(now: Date = new Date()): boolean {
  const tz = getSetting("send_window_tz");
  const start = getSetting("send_window_start");
  const end = getSetting("send_window_end");
  const daysEnv = getSetting("send_window_days").toLowerCase();
  const allowedDays = parseDays(daysEnv);

  // formatiranje vremena u zadatoj TZ
  const localFmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = localFmt.formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value?.toLowerCase() || "";
  const hh = parts.find((p) => p.type === "hour")?.value || "00";
  const mm = parts.find((p) => p.type === "minute")?.value || "00";
  const minuteOfDay = parseInt(hh, 10) * 60 + parseInt(mm, 10);

  const startMin = parseHHMM(start);
  const endMin = parseHHMM(end);

  if (!allowedDays.includes(weekday)) return false;
  return minuteOfDay >= startMin && minuteOfDay < endMin;
}

function parseHHMM(s: string): number {
  const [h, m] = s.split(":").map((x) => parseInt(x, 10));
  return h * 60 + m;
}

function parseDays(s: string): string[] {
  // podržava "mon-fri", "mon,wed,fri", ili pojedinačne dane
  const order = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  const t = s.trim().toLowerCase();
  if (t.includes("-")) {
    const [from, to] = t.split("-").map((x) => x.trim());
    const fi = order.indexOf(from);
    const ti = order.indexOf(to);
    if (fi >= 0 && ti >= 0 && fi <= ti) return order.slice(fi, ti + 1);
  }
  return t.split(/[,\s]+/).filter(Boolean);
}

/**
 * Broj poslatih emailova za sender u poslednjih X sekundi.
 */
export function sentCountForSender(senderId: number, windowSec: number): number {
  const db = getDb();
  const since = Date.now() - windowSec * 1000;
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.emailSends)
    .where(
      and(
        eq(schema.emailSends.senderId, senderId),
        eq(schema.emailSends.status, "sent"),
        gte(schema.emailSends.sentAt, new Date(since)),
      ),
    )
    .all()[0];
  return Number(row?.c ?? 0);
}

/**
 * Bounce rate u poslednjih N slanja (sent + bounced) u poslednjih M dana.
 * Parametri se čitaju iz settings (DB > env > default).
 * Vraća 0–1.
 */
export function recentBounceRate(): number {
  const db = getDb();
  const windowDays = getSettingInt("bounce_window_days") || 7;
  const sampleSize = getSettingInt("bounce_sample_size") || 50;
  const rows = db
    .select({ status: schema.emailSends.status })
    .from(schema.emailSends)
    .where(gte(schema.emailSends.sentAt, new Date(Date.now() - windowDays * 24 * 3600 * 1000)))
    .orderBy(sql`${schema.emailSends.sentAt} DESC`)
    .limit(sampleSize)
    .all();
  const sent = rows.filter((r) => r.status === "sent" || r.status === "bounced").length;
  const bounced = rows.filter((r) => r.status === "bounced").length;
  return sent > 0 ? bounced / sent : 0;
}

/**
 * Izaberi sledeći aktivni sender round-robin (najstariji last_used_at).
 * Vraća null ako nema aktivnih ili su svi dosegli cap.
 */
export function pickNextSender(): { id: number; email: string; fromName: string; smtpHost: string; smtpPort: number; username: string; passwordEncrypted: string; dailyCap: number; hourlyCap: number; minDelaySec: number; maxDelaySec: number } | null {
  const db = getDb();
  const candidates = db
    .select()
    .from(schema.senders)
    .where(eq(schema.senders.active, true))
    .orderBy(asc(schema.senders.lastUsedAt))
    .all();

  const hourStart = Date.now() - 3600 * 1000;
  const dayStart = Date.now() - 24 * 3600 * 1000;

  for (const s of candidates) {
    const hourly = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.emailSends)
      .where(
        and(
          eq(schema.emailSends.senderId, s.id),
          eq(schema.emailSends.status, "sent"),
          gte(schema.emailSends.sentAt, new Date(hourStart)),
        ),
      )
      .all()[0];
    const daily = db
      .select({ c: sql<number>`count(*)` })
      .from(schema.emailSends)
      .where(
        and(
          eq(schema.emailSends.senderId, s.id),
          eq(schema.emailSends.status, "sent"),
          gte(schema.emailSends.sentAt, new Date(dayStart)),
        ),
      )
      .all()[0];

    const hourlyCount = Number(hourly?.c ?? 0);
    const dailyCount = Number(daily?.c ?? 0);
    if (hourlyCount >= s.hourlyCap) continue;
    if (dailyCount >= s.dailyCap) continue;
    return s;
  }
  return null;
}

/**
 * Random delay u opsegu sender-a (sec).
 */
export function randomDelaySec(min: number, max: number): number {
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

/**
 * Provera da li je lead dozvoljen za slanje.
 */
export function canSendToLead(leadId: number): { ok: boolean; reason?: string } {
  const db = getDb();
  const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, leadId)).all();
  if (!lead) return { ok: false, reason: "Lead ne postoji" };
  if (lead.doNotContact) return { ok: false, reason: "Lead u blocklist" };
  if (!lead.email) return { ok: false, reason: "Lead nema email" };
  return { ok: true };
}