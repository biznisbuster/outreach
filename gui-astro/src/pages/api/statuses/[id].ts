import type { APIRoute } from "astro";
import { getDb, schema, ok, bad, notFound } from "../../../lib/api";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../../lib/audit";

const patchSchema = z.object({
  name: z.string().min(1).max(40).optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  isTerminalWon: z.boolean().optional(),
  isTerminalLost: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export const PATCH: APIRoute = async ({ params, request }) => {
  const id = Number(params.id);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Neispravan unos");
  const db = getDb();
  const [updated] = db
    .update(schema.statuses)
    .set(parsed.data)
    .where(eq(schema.statuses.id, id))
    .returning()
    .all();
  if (!updated) return notFound();
  logAudit("settings.change", "status", id, parsed.data as Record<string, unknown>);
  return ok(updated);
};

export const DELETE: APIRoute = async ({ params, redirect, request }) => {
  const id = Number(params.id);
  const db = getDb();

  // Proveri da li neki lead koristi ovaj status
  const used = db
    .select({ n: schema.leads.id })
    .from(schema.leads)
    .where(eq(schema.leads.statusId, id))
    .all();
  if (used.length > 0) {
    // Ako je došlo iz forme, vrati se sa greškom; ako API, vrati 409
    const ct = request.headers.get("content-type") ?? "";
    if (ct.includes("json")) {
      return new Response(JSON.stringify({ error: `Status koristi ${used.length} leadova` }), {
        status: 409,
        headers: { "Content-Type": "application/json" },
      });
    }
    return redirect(`/statuses?error=${encodeURIComponent(`Status koristi ${used.length} leadova — ne može se obrisati`)}`, 303);
  }

  db.delete(schema.statuses).where(eq(schema.statuses.id, id)).run();
  logAudit("settings.change", "status", id, { deleted: true });

  const ct = request.headers.get("content-type") ?? "";
  if (ct.includes("json")) return ok({ ok: true });
  return redirect(`/statuses?ok=${encodeURIComponent("Status obrisan")}`, 303);
};
