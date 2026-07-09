/** GET /api/attachments — list. POST — upload. */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../lib/api";
import { getDb, schema } from "../../../lib/db";
import { desc } from "drizzle-orm";
import { saveAttachment, validateUpload, getAttachmentUsage } from "../../../lib/attachments";

export const GET: APIRoute = async () => {
  const db = getDb();
  const rows = db
    .select()
    .from(schema.attachments)
    .orderBy(desc(schema.attachments.id))
    .all();
  // Dodaj usage info za UI
  const items = rows.map((r) => {
    const u = getAttachmentUsage(r.id);
    return { ...r, usedByTemplates: u.usedByTemplates, usedByDrafts: u.usedByDrafts };
  });
  return ok({ items });
};

export const POST: APIRoute = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return bad("Mora biti multipart/form-data");
  }

  const file = form.get("file");
  if (!(file instanceof File)) return bad("Polje 'file' nedostaje");

  const v = validateUpload(file);
  if (!v.ok) return bad(v.error || "Neispravan fajl", 400);

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const saved = await saveAttachment(bytes, {
      originalName: file.name,
      mimeType: file.type,
    });
    return ok(saved, 201);
  } catch (e) {
    return bad(`Upload greška: ${e instanceof Error ? e.message : String(e)}`, 500);
  }
};