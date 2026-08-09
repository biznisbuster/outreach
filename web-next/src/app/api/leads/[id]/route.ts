import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/core/db";
import { logAudit } from "@/core/audit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const patchSchema = z.object({
  name: z.string().optional(),
  category: z.string().optional().nullable(),
  phoneRaw: z.string().optional().nullable(),
  phoneE164: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  websiteRaw: z.string().optional().nullable(),
  websiteNormalized: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  postalCode: z.string().optional().nullable(),
  googleRating: z.number().optional().nullable(),
  reviewsCount: z.number().optional().nullable(),
  source: z.string().optional().nullable(),
  sourceUrl: z.string().optional().nullable(),
  statusId: z.number().optional().nullable(),
  doNotContact: z.boolean().optional(),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return Response.json({ error: "Neispravan id" }, { status: 400 });

  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Neispravan unos" }, { status: 400 });
  }

  const db = getDb();
  const before = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!before) return Response.json({ error: "Lead nije pronađen" }, { status: 404 });

  const [updated] = db
    .update(schema.leads)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(schema.leads.id, id))
    .returning()
    .all();

  if (parsed.data.statusId !== undefined && parsed.data.statusId !== before.statusId) {
    logAudit("lead.status_change", "lead", id, { from: before.statusId, to: parsed.data.statusId });
  } else {
    logAudit("lead.update", "lead", id, parsed.data as Record<string, unknown>);
  }
  return Response.json(updated);
}
