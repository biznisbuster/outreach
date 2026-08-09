import { eq } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { getDb, schema } from "@/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function storageDir(): string {
  const envPath = process.env.OUTREACH_DATA_DIR || process.env.DATA_DIR;
  if (envPath) return join(process.cwd(), envPath, "attachments");
  return join(process.cwd(), "data", "attachments");
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return new Response("Neispravan id", { status: 400 });

  const db = getDb();
  const att = db.select().from(schema.attachments).where(eq(schema.attachments.id, id)).get();
  if (!att) return new Response("Ne postoji", { status: 404 });

  try {
    const bytes = await readFile(join(storageDir(), att.filename));
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
    return new Response("Fajl nedostaje na disku", { status: 404 });
  }
}
