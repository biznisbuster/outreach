/**
 * GET /api/unsubscribe — HMAC zaštićen unsubscribe (bez auth).
 * Format: ?id={emailSendId}&token={hmac(emailSendId)}
 *
 * Na GET vraća malu HTML stranicu koja potvrdi odjavu (single-user app,
 * bez logina). Takođe prihvata POST (programabilni mailto: list-unsubscribe).
 */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../lib/api";
import { eq } from "drizzle-orm";
import { signHmac, verifyHmac } from "../../lib/crypto";

function confirmHtml(leadName: string | null, alreadyDone: boolean): string {
  return `<!doctype html>
<html lang="sr"><head><meta charset="utf-8"><title>Odjava</title>
<style>body{font:14px system-ui;padding:40px;max-width:480px;margin:0 auto;color:#1f2937}
.ok{background:#dcfce7;color:#166534;padding:16px;border-radius:6px}
.already{background:#f3f4f6;color:#6b7280;padding:16px;border-radius:6px}
h1{font-size:20px;margin:0 0 12px}</style></head><body>
<h1>Odjava sa mailing liste</h1>
${alreadyDone
  ? `<div class="already"><p>Ovaj email je već odjavljen sa liste.</p></div>`
  : `<div class="ok"><p><strong>${escape(leadName ?? "Vi")}</strong> je uspešno odjavljen${alreadyDone ? "" : " sa mailing liste"}.</p><p>Nećeš više dobijati emailove od nas.</p></div>`}
<p style="margin-top:24px"><a href="/">Nazad na Outreach</a></p>
</body></html>`;
}

function escape(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function doUnsubscribe(id: number): { ok: true; leadName: string | null; already: boolean } | { ok: false } {
  const db = getDb();
  const [es] = db
    .select({ leadId: schema.emailSends.leadId })
    .from(schema.emailSends)
    .where(eq(schema.emailSends.id, id))
    .all();
  if (!es) return { ok: false };

  // Proveri da li je već na blocklist-u
  const existing = db
    .select({ id: schema.blocklist.id })
    .from(schema.blocklist)
    .where(eq(schema.blocklist.leadId, es.leadId))
    .limit(1)
    .all();
  if (existing.length > 0) {
    const [lead] = db.select({ name: schema.leads.name }).from(schema.leads).where(eq(schema.leads.id, es.leadId)).all();
    return { ok: true, leadName: lead?.name ?? null, already: true };
  }

  db.insert(schema.blocklist).values({ leadId: es.leadId, reason: "unsubscribe" }).run();
  db.update(schema.leads).set({ doNotContact: true }).where(eq(schema.leads.id, es.leadId)).run();
  const [lead] = db.select({ name: schema.leads.name }).from(schema.leads).where(eq(schema.leads.id, es.leadId)).all();
  return { ok: true, leadName: lead?.name ?? null, already: false };
}

export const GET: APIRoute = ({ url }) => {
  const id = Number(url.searchParams.get("id"));
  const token = url.searchParams.get("token") ?? "";
  if (!id || !token || !verifyHmac(String(id), token)) {
    return new Response("Neispravan unsubscribe link.", { status: 400 });
  }
  const r = doUnsubscribe(id);
  if (!r.ok) return new Response("Email send ne postoji.", { status: 404 });
  return new Response(confirmHtml(r.leadName, r.already), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};

export const POST: APIRoute = async ({ request }) => {
  // Programabilni List-Unsubscribe-Post: prima isti querystring.
  const url = new URL(request.url);
  const id = Number(url.searchParams.get("id"));
  const token = url.searchParams.get("token") ?? "";
  if (!id || !token || !verifyHmac(String(id), token)) {
    return new Response(JSON.stringify({ error: "Neispravan token" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const r = doUnsubscribe(id);
  return new Response(JSON.stringify(r), { status: 200, headers: { "Content-Type": "application/json" } });
};

// Helper koji se koristi pri slanju da izgeneriše unsubscribe URL
export function makeUnsubscribeUrl(id: number, baseUrl: string): string {
  const token = signHmac(String(id));
  const u = new URL("/api/unsubscribe", baseUrl);
  u.searchParams.set("id", String(id));
  u.searchParams.set("token", token);
  return u.toString();
}
