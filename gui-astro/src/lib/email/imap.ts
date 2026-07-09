import { ImapFlow } from "imapflow";
import { getDb, schema } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { getSetting, getSettingInt, getSettingBool } from "@/lib/settings";

const SETTING_LAST_UID = "imap_last_uid";

let started = false;
let interval: ReturnType<typeof setInterval> | null = null;

export function startImapPoller() {
  if (started) return;
  const host = getSetting("imap_host");
  const user = getSetting("imap_user");
  const pass = getSetting("imap_password");
  if (!host || !user || !pass) {
    console.log("[imap] IMAP podešavanja nisu kompletna, poller nije pokrenut");
    return;
  }
  started = true;
  const intervalMin = getSettingInt("imap_poll_minutes") || 5;
  const tickMs = intervalMin * 60 * 1000;
  console.log(`[imap] poller startovan (svakih ${intervalMin} min)`);
  void pollImap().catch((e) => console.error("[imap] poll greška:", e));
  interval = setInterval(() => {
    void pollImap().catch((e) => console.error("[imap] poll greška:", e));
  }, tickMs);
}

export function stopImapPoller() {
  if (interval) clearInterval(interval);
  interval = null;
  started = false;
}

function getLastUid(): number {
  const db = getDb();
  const [row] = db.select().from(schema.settings).where(eq(schema.settings.key, SETTING_LAST_UID)).all();
  return row ? Number(row.value || "0") : 0;
}

function setLastUid(uid: number) {
  const db = getDb();
  const [row] = db.select().from(schema.settings).where(eq(schema.settings.key, SETTING_LAST_UID)).all();
  if (row) {
    db.update(schema.settings).set({ value: String(uid) }).where(eq(schema.settings.key, SETTING_LAST_UID)).run();
  } else {
    db.insert(schema.settings).values({ key: SETTING_LAST_UID, value: String(uid) }).run();
  }
}

export async function pollImap(): Promise<{ processed: number; matched: number }> {
  const host = getSetting("imap_host");
  const user = getSetting("imap_user");
  const pass = getSetting("imap_password");
  const folder = getSetting("imap_folder") || "INBOX";
  const port = getSettingInt("imap_port") || 993;
  if (!host || !user || !pass) return { processed: 0, matched: 0 };

  const client = new ImapFlow({
    host,
    port,
    secure: getSettingBool("imap_secure"),
    auth: { user, pass },
    logger: false,
  });

  const result = { processed: 0, matched: 0 };
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      const lastUid = getLastUid();
      // čitaj sve od poslednjeg viđenog UID-a
      const range = lastUid > 0 ? `${lastUid + 1}:*` : "1:*";
      const uids = await client.search({ uid: range }, { uid: true });
      if (!uids || uids.length === 0) {
        return result;
      }
      result.processed = uids.length;
      let maxUid = lastUid;

      // učitaj leadove i email_send-ove radi matchinga
      const db = getDb();
      const leads = db.select({ id: schema.leads.id, email: schema.leads.email }).from(schema.leads).all();
      const leadByEmail = new Map<string, number>();
      for (const l of leads) {
        if (l.email) leadByEmail.set(l.email.toLowerCase(), l.id);
      }
      const sentMsgs = db
        .select({ id: schema.emailSends.id, messageId: schema.emailSends.messageId, leadId: schema.emailSends.leadId })
        .from(schema.emailSends)
        .where(eq(schema.emailSends.status, "sent"))
        .all();
      const msgByMessageId = new Map<string, { emailSendId: number; leadId: number }>();
      for (const m of sentMsgs) {
        if (m.messageId) {
          // message-id format: <id@domain>
          const clean = m.messageId.replace(/[<>]/g, "");
          msgByMessageId.set(clean, { emailSendId: m.id, leadId: m.leadId });
        }
      }

      const messages = await client.fetchAll(uids, { uid: true, envelope: true, source: false }, { uid: true });
      for (const msg of messages) {
        maxUid = Math.max(maxUid, msg.uid);
        const fromAddr = (msg.envelope?.from?.[0]?.address || "").toLowerCase();
        const subject = msg.envelope?.subject || "";
        const inReplyTo = msg.envelope?.inReplyTo;

        let matched: { leadId: number; emailSendId?: number; by: string } | null = null;

        // 1) alias/from match
        if (fromAddr && leadByEmail.has(fromAddr)) {
          matched = { leadId: leadByEmail.get(fromAddr)!, by: "alias" };
        }
        // 2) In-Reply-To / References thread match
        if (!matched && inReplyTo) {
          const clean = inReplyTo.replace(/[<>]/g, "");
          const hit = msgByMessageId.get(clean);
          if (hit) matched = { leadId: hit.leadId, emailSendId: hit.emailSendId, by: "thread" };
        }

        if (matched) {
          // upiši reply
          db.insert(schema.emailReplies)
            .values({
              leadId: matched.leadId,
              emailSendId: matched.emailSendId ?? null,
              fromEmail: fromAddr,
              subject,
              body: null, // ne čuvamo telo (privacy + size)
              receivedAt: new Date(),
              matchedBy: matched.by,
            })
            .run();

          // markiraj email_send-ove kao replied (sve sent za lead)
          db.update(schema.emailSends)
            .set({ replied: true, repliedAt: new Date() })
            .where(and(eq(schema.emailSends.leadId, matched.leadId), eq(schema.emailSends.replied, false)))
            .run();

          // stop queued za lead
          db.update(schema.emailSends)
            .set({ status: "failed", error: "Reply — sekvenca stopirana" })
            .where(and(eq(schema.emailSends.leadId, matched.leadId), eq(schema.emailSends.status, "queued")))
            .run();

          // promeni status leada u "Odgovorio"
          const odgovorio = db
            .select()
            .from(schema.statuses)
            .where(eq(schema.statuses.name, "Odgovorio"))
            .limit(1)
            .all()[0];
          if (odgovorio) {
            db.update(schema.leads)
              .set({ statusId: odgovorio.id })
              .where(eq(schema.leads.id, matched.leadId))
              .run();
          }

          result.matched++;
        }
      }
      if (maxUid > lastUid) setLastUid(maxUid);
    } finally {
      lock.release();
    }
    await client.logout();
  } catch (e) {
    console.error("[imap] greška:", e instanceof Error ? e.message : String(e));
  }
  return result;
}