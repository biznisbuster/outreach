import nodemailer, { type Transporter } from "nodemailer";
import { decrypt } from "@/lib/crypto";

export interface SendInput {
  host: string;
  port: number;
  username: string;
  passwordEncrypted: string;
  fromEmail: string;
  fromName: string;
  toEmail: string;
  subject: string;
  body: string;
  replyTo?: string;
  // za unsubscribe link
  unsubscribeUrl?: string;
  // ID za tracking
  emailSendId: number;
}

export interface SendResult {
  ok: boolean;
  messageId?: string;
  error?: string;
  bounce?: boolean;
}

const transporterCache = new Map<string, Transporter>();

/** Vraća transporter za dati sender (kešira po host+username). */
export function getTransporter(host: string, port: number, user: string, pass: string): Transporter {
  const key = `${host}:${port}:${user}`;
  let t = transporterCache.get(key);
  if (!t) {
    t = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
      tls: { rejectUnauthorized: false },
    });
    transporterCache.set(key, t);
  }
  return t;
}

/** Pošalji email. Vraća {ok, messageId, error, bounce}. */
export async function sendEmail(input: SendInput): Promise<SendResult> {
  const password = decrypt(input.passwordEncrypted);
  const transporter = getTransporter(input.host, input.port, input.username, password);

  const from = `"${input.fromName}" <${input.fromEmail}>`;
  const text = input.unsubscribeUrl
    ? input.body + `\n\n---\nAko ne želiš više da te kontaktiramo: ${input.unsubscribeUrl}\n`
    : input.body;

  try {
    const headerPairs: { key: string; value: string }[] = [{ key: "X-Outreach-Send-Id", value: String(input.emailSendId) }];
    if (input.unsubscribeUrl) headerPairs.push({ key: "List-Unsubscribe", value: `<${input.unsubscribeUrl}>` });

    const info = (await transporter.sendMail({
      from,
      to: input.toEmail,
      subject: input.subject,
      text,
      replyTo: input.replyTo || input.fromEmail,
      headers: headerPairs,
    })) as { messageId?: string };
    return { ok: true, messageId: info.messageId };
  } catch (e: unknown) {
    const err = e as { responseCode?: number; message?: string };
    const code = err.responseCode;
    const msg = err.message || String(e);
    const bounce = typeof code === "number" && code >= 500 && code < 600;
    return { ok: false, error: msg, bounce };
  }
}

/**
 * Verifikuj SMTP konekciju (za "Testiraj slanje" dugme).
 * Vraća {ok, error?}.
 */
export async function verifySmtp(host: string, port: number, user: string, passwordEncrypted: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const password = decrypt(passwordEncrypted);
    const t = getTransporter(host, port, user, password);
    await t.verify();
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}