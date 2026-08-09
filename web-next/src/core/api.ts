/**
 * Helperi za API endpoints (Astro).
 * Zamena za NextResponse / next-auth getServerSession.
 */
import { getDb, getRaw, schema } from "./db";
import { and, eq } from "drizzle-orm";

export function ok<T>(data: T, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function bad(msg: string, status = 400): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function notFound(msg = "Nije pronađeno"): Response {
  return new Response(JSON.stringify({ error: msg }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
}

export function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Nije dozvoljeno" }), { status: 401 });
}

export function qpInt(v: string | null, def: number): number {
  if (v === null || v === "") return def;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? def : n;
}

/** Konvertuje SQLite timestamp_ms broj u JS Date. */
export function tsToDate(v: number | string | Date | null | undefined): Date | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number") return new Date(v);
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return new Date(n);
    const d = new Date(v);
    return isFinite(d.getTime()) ? d : null;
  }
  return null;
}

export { getDb, getRaw, schema, and, eq };
