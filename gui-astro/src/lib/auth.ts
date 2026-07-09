import { getDb, schema } from "./db";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";

export async function verifyPassword(password: string): Promise<boolean> {
  const db = getDb();
  const user = db.select().from(schema.users).all()[0];
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** Za test/seed: kreiraj defaultnog korisnika ako ne postoji. */
export async function ensureSingleUser(): Promise<void> {
  const db = getDb();
  const existing = db.select().from(schema.users).all();
  if (existing.length > 0) return;

  const plain = process.env.AUTH_PASSWORD;
  const hash = process.env.AUTH_PASSWORD_HASH;
  let passwordHash: string | null = null;
  if (plain && !plain.startsWith("replace")) {
    passwordHash = await hashPassword(plain);
    console.log("[auth] Kreiran default single-user iz AUTH_PASSWORD.");
  } else if (hash && !hash.startsWith("replace")) {
    passwordHash = hash;
    console.log("[auth] Kreiran default single-user iz AUTH_PASSWORD_HASH.");
  }
  if (passwordHash) {
    db.insert(schema.users).values({ passwordHash }).run();
  }
}

export function isAuthOnlyPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/api/auth/") || pathname.startsWith("/api/unsubscribe");
}
