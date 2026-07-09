/** GET /api/attachments/[id]/file — download/preview binarno. */
import type { APIRoute } from "astro";
import { bad } from "../../../../lib/api";
import { getDb, schema } from "../../../../lib/db";
import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

function storageDir(): string {
  const envPath = process.env.OUTREACH_DATA_DIR || process.env.DATA_DIR;
  if (envPath) return join(envPath, "attachments");
  return join(process.cwd(), "data", "attachments");
}

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return bad("Neispravan id");
  const db = getDb();
  const att = db.select().from(schema.attachments).where(eq(schema.attachments.id, id)).all()[0];
  if (!att) return bad("Ne postoji", 404);

  try {
    const bytes = await readFile(join(storageDir(), att.filename));
    // Vrati kao Uint8Array (Astro/Response podržava)
    return new Response(new Uint8Array(bytes), {
      status: 200,
      headers: {
        "Content-Type": att.mimeType,
        "Content-Length": String(bytes.length),
        "Content-Disposition": `inline; filename="${att.originalName.replace(/"/g, "")}"`,
        "Cache-Control": "private, max-age=300",
      },
    });
  } catch {
    return bad("Fajl nedostaje na disku", 404);
  }
};