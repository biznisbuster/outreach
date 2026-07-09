/** GET /api/attachments/[id] — metadata. DELETE — ukloni attachment. */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../lib/api";
import { getDb, schema } from "../../../lib/db";
import { eq } from "drizzle-orm";
import { deleteAttachment, getAttachmentUsage } from "../../../lib/attachments";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return bad("Neispravan id");
  const db = getDb();
  const att = db.select().from(schema.attachments).where(eq(schema.attachments.id, id)).all()[0];
  if (!att) return bad("Ne postoji", 404);
  const u = getAttachmentUsage(id);
  return ok({ ...att, usedByTemplates: u.usedByTemplates, usedByDrafts: u.usedByDrafts });
};

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return bad("Neispravan id");
  try {
    const result = await deleteAttachment(id);
    if (!result.ok) return bad(result.error || "Brisanje neuspešno", 409);
    return ok({ deleted: true });
  } catch (e) {
    return bad(`Brisanje greška: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
};