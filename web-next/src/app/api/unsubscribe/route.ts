import { eq } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { verifyHmac } from "@/core/crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function confirmHtml(leadName: string | null, alreadyDone: boolean): string {
  return `<!doctype html>
<html lang="sr"><head><meta charset="utf-8"><title>Odjava</title>
<style>body{font:14px system-ui;padding:40px;max-width:480px;margin:0 auto;color:#1f2937}
.ok{background:#dcfce7;color:#166534;padding:16px;border-radius:6px}
.already{background:#f3f4f6;color:#6b7280;padding:16px;border-radius:6px}
h1{font-size:20px;margin:0 0 12px}</style></head><body>
<h1>Odjava sa mailing liste</h1>
${
  alreadyDone
    ? `<div class="already"><p>Ovaj email je već odjavljen sa liste.</p></div>`
    : `<div class="ok"><p><strong>${escapeHtml(leadName ?? "Vi")}</strong> je uspešno odjavljen sa mailing liste.</p><p>Nećeš više dobijati emailove od nas.</p></div>`
}
</body></html>`;
}

function doUnsubscribe(id: number): { ok: true; leadName: string | null; already: boolean } | { ok: false } {
  const db = getDb();
  const es = db
    .select({ leadId: schema.emailSends.leadId })
    .from(schema.emailSends)
    .where(eq(schema.emailSends.id, id))
    .get();
  if (!es) return { ok: false };

  const existing = db
    .select({ id: schema.blocklist.id })
    .from(schema.blocklist)
    .where(eq(schema.blocklist.leadId, es.leadId))
    .limit(1)
    .all();

  const lead = db.select({ name: schema.leads.name }).from(schema.leads).where(eq(schema.leads.id, es.leadId)).get();

  if (existing.length > 0) {
    return { ok: true, leadName: lead?.name ?? null, already: true };
  }

  db.insert(schema.blocklist).values({ leadId: es.leadId, reason: "unsubscribe" }).run();
  db.update(schema.leads).set({ doNotContact: true }).where(eq(schema.leads.id, es.leadId)).run();
  return { ok: true, leadName: lead?.name ?? null, already: false };
}

async function handle(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const token = url.searchParams.get("token") ?? "";

  if (!Number.isFinite(id) || !verifyHmac(String(id), token)) {
    return new Response("Nevažeći link za odjavu", { status: 400 });
  }

  const result = doUnsubscribe(id);
  if (!result.ok) return new Response("Email ne postoji", { status: 404 });

  if (req.method === "POST") {
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }
  return new Response(confirmHtml(result.leadName, result.already), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

export const GET = handle;
export const POST = handle;
