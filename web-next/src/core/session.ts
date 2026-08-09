import { signHmac } from "./crypto";

/**
 * Minimalna cookie-bazirana single-user sesija (ista šema kao gui-astro).
 *
 * Format cookija: `outreach_sid=<userId>.<HMAC>`.
 * - userId = "1" (single-user)
 * - HMAC = HMAC-SHA256("outreach_sid|" + userId, ENCRYPTION_KEY)
 *
 * Time-out: 7 dana, klijet ga nosi; server validira pri svakom requestu.
 * Framework-agnostično: radi sa bilo kojom cookie implementacijom koja
 * čita/piše string vrednosti.
 */

export const SESSION_COOKIE = "outreach_sid";
export const SESSION_MAX_AGE_SEC = 7 * 24 * 60 * 60; // 7 dana

export interface Session {
  userId: string;
}

export function createSessionToken(userId = "1"): string {
  return `${userId}.${signHmac(`outreach_sid|${userId}`)}`;
}

export function parseSessionToken(raw?: string): Session | null {
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);

  const expected = signHmac(`outreach_sid|${userId}`);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return null;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0 ? { userId } : null;
}
