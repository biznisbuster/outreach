import { getDb, schema } from "@/lib/db";
import { eq, and, sql, asc } from "drizzle-orm";
import { sendEmail } from "@/lib/email/sender";
import { pickNextSender, isWithinSendWindow, canSendToLead, recentBounceRate } from "@/lib/email/throttler";
import { signHmac } from "@/lib/crypto";
import { getSetting, getSettingInt } from "@/lib/settings";
import { advanceSequence } from "@/lib/email/sequence";

let started = false;
let interval: ReturnType<typeof setInterval> | null = null;

export function startScheduler() {
  if (started) return;
  started = true;
  const tickMs = getSettingInt("scheduler_tick_ms") || 60000;
  console.log(`[scheduler] startovan (tick ${tickMs}ms)`);
  void processQueue().catch((e) => console.error("[scheduler] tick error:", e));
  interval = setInterval(() => {
    void processQueue().catch((e) => console.error("[scheduler] tick error:", e));
  }, tickMs);

  // IMAP poller (reply tracking) — fire-and-forget dynamic import
  void import("@/lib/email/imap")
    .then(({ startImapPoller }) => {
      try {
        startImapPoller();
      } catch (e) {
        console.error("[scheduler] IMAP poller greška:", e);
      }
    })
    .catch((e) => console.error("[scheduler] IMAP import greška:", e));
}

export function stopScheduler() {
  if (interval) clearInterval(interval);
  interval = null;
  started = false;
}

/** Bounce threshold kao procenat (0-100), deli se sa 100 u poređenju. */
function getBounceThreshold(): number {
  return (getSettingInt("bounce_threshold_pct") || 5) / 100;
}

/** Batch size koliko queued emailova obrađujemo u jednom tick-u. */
function getBatchSize(): number {
  return Math.max(1, getSettingInt("scheduler_batch_size") || 20);
}

/**
 * Obradi queued emailove: uzmi najstariji queued, proveri cap + prozor + bounce,
 * pošalji preko nodemailer, upiši rezultat.
 */
export async function processQueue(): Promise<{ processed: number; sent: number; skipped: number; failed: number }> {
  const db = getDb();
  const result = { processed: 0, sent: 0, skipped: 0, failed: 0 };

  // 1) bounce guard — ako je rate > threshold, pauziraj sve sendere
  const bounceRate = recentBounceRate();
  if (bounceRate > getBounceThreshold()) {
    db.update(schema.senders).set({ active: false }).where(eq(schema.senders.active, true)).run();
    console.warn(`[scheduler] bounce rate ${(bounceRate * 100).toFixed(1)}% > 5%, svi senderi pauzirani`);
    return result;
  }

  // 2) prozor slanja
  if (!isWithinSendWindow()) {
    console.log("[scheduler] skip: van prozora slanja");
    return result; // van prozora — preskoči
  }

  // 3) nađi queued redove (ograniči batch)
  const queued = db
    .select()
    .from(schema.emailSends)
    .where(and(eq(schema.emailSends.status, "queued"), sql`${schema.emailSends.queuedAt} IS NOT NULL`))
    .orderBy(asc(schema.emailSends.queuedAt))
    .limit(getBatchSize())
    .all();
  console.log(`[scheduler] found ${queued.length} queued`);

  for (const es of queued) {
    result.processed++;

    // dozvola za lead
    const perm = canSendToLead(es.leadId);
    if (!perm.ok) {
      db.update(schema.emailSends)
        .set({ status: "failed", error: perm.reason })
        .where(eq(schema.emailSends.id, es.id))
        .run();
      result.skipped++;
      continue;
    }

    // izaberi sender
    const sender = pickNextSender();
    if (!sender) {
      // nema dostupnog — ostavi queued
      console.log(`[scheduler] queued #${es.id}: nema dostupnog sendera`);
      result.skipped++;
      continue;
    }

    const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, es.leadId)).all();
    if (!lead || !lead.email) {
      db.update(schema.emailSends)
        .set({ status: "failed", error: "Nema email" })
        .where(eq(schema.emailSends.id, es.id))
        .run();
      result.skipped++;
      continue;
    }

    // unsubscribe URL
    const unsubBase = getSetting("unsubscribe_base_url") || "";
    const token = signHmac(`unsubscribe:${es.id}`);
    const unsubUrl = unsubBase ? `${unsubBase}/api/unsubscribe?id=${es.id}&token=${token}` : undefined;

    // pošalji
    const sendRes = await sendEmail({
      host: sender.smtpHost,
      port: sender.smtpPort,
      username: sender.username,
      passwordEncrypted: sender.passwordEncrypted,
      fromEmail: sender.email,
      fromName: sender.fromName,
      toEmail: lead.email,
      subject: es.subject,
      body: es.body,
      unsubscribeUrl: unsubUrl,
      emailSendId: es.id,
    });

    if (sendRes.ok) {
      db.update(schema.emailSends)
        .set({
          status: "sent",
          senderId: sender.id,
          sentAt: new Date(),
          messageId: sendRes.messageId ?? null,
          reviewed: true,
        })
        .where(eq(schema.emailSends.id, es.id))
        .run();
      db.update(schema.senders)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.senders.id, sender.id))
        .run();
      // napredovanje sekvence (ako postoji) — enqueue sledećeg koraka
      try {
        await advanceSequence(es.id, es.leadId, lead.campaignId, new Date());
      } catch (e) {
        console.error("[scheduler] advanceSequence greška:", e);
      }
      result.sent++;
    } else {
      db.update(schema.emailSends)
        .set({
          status: sendRes.bounce ? "bounced" : "failed",
          senderId: sender.id,
          error: sendRes.error || "Nepoznata greška",
        })
        .where(eq(schema.emailSends.id, es.id))
        .run();
      result.failed++;
      if (sendRes.bounce) {
        db.update(schema.leads).set({ doNotContact: true }).where(eq(schema.leads.id, es.leadId)).run();
        // ensure blocklist entry
        const inBl = db.select().from(schema.blocklist).where(eq(schema.blocklist.leadId, es.leadId)).limit(1).all();
        if (inBl.length === 0) {
          db.insert(schema.blocklist).values({ leadId: es.leadId, reason: "Hard bounce" }).run();
        }
      }
    }
  }

  if (result.processed > 0) {
    console.log(`[scheduler] tick: processed=${result.processed} sent=${result.sent} skipped=${result.skipped} failed=${result.failed}`);
  }
  return result;
}