/**
 * Minimalna cookie-bazirana single-user sesija.
 *
 * Format cookija: `outreach_sid=<userId>.<HMAC>`.
 * - userId = "1" (single-user)
 * - HMAC = HMAC-SHA256("outreach_sid|" + userId, AUTH_SECRET)
 *
 * Time-out: 7 dana, sliding (produžava se pri svakoj validaciji).
 */
import type { AstroCookies } from "astro";
import { signHmac } from "./crypto";

export const SESSION_COOKIE = "outreach_sid";
const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET mora biti najmanje 16 karaktera");
  return s;
}

function sign(userId: string): string {
  return signHmac(`outreach_sid|${userId}`);
}

function verify(userId: string, sig: string): boolean {
  const expected = sign(userId);
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  if (a.length !== b.length) return false;
  let acc = 0;
  for (let i = 0; i < a.length; i++) acc |= a[i] ^ b[i];
  return acc === 0;
}

export interface Session {
  userId: string;
}

export function readSession(cookies: AstroCookies): Session | null {
  const raw = cookies.get(SESSION_COOKIE)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot < 0) return null;
  const userId = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  if (!verify(userId, sig)) return null;
  return { userId };
}

export function writeSession(cookies: AstroCookies, userId = "1"): void {
  const value = `${userId}.${sign(userId)}`;
  cookies.set(SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: Math.floor(ONE_WEEK_MS / 1000),
  });
}

export function clearSession(cookies: AstroCookies): void {
  cookies.delete(SESSION_COOKIE, { path: "/" });
}

export function ensureSecret(): void {
  // No-op — koristimo getSecret() interno. Ovde radi samo assert u dev-u.
  getSecret();
}
