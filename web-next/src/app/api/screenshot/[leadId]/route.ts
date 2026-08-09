import { eq, desc } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";
import { getDb, schema } from "@/core/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ leadId: string }> }) {
  const { leadId: idRaw } = await ctx.params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) return new Response("Neispravan id", { status: 400 });

  const db = getDb();
  const screenshot = db
    .select()
    .from(schema.screenshots)
    .where(eq(schema.screenshots.leadId, id))
    .orderBy(desc(schema.screenshots.capturedAt))
    .get();
  if (!screenshot) return new Response("Screenshot ne postoji", { status: 404 });

  const base = screenshot.path.split("/").pop() ?? screenshot.path;
  const candidates = [
    screenshot.path,
    path.resolve(process.cwd(), "..", "data", "screenshots", base),
    path.resolve(process.cwd(), "data", "screenshots", base),
    path.resolve(process.cwd(), process.env.SCREENSHOTS_DIR ?? "../data/screenshots", base),
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const buf = fs.readFileSync(c);
        return new Response(new Uint8Array(buf), {
          status: 200,
          headers: { "Content-Type": "image/png", "Cache-Control": "private, max-age=300" },
        });
      }
    } catch {
      /* nastavi */
    }
  }
  return new Response("Screenshot fajl ne postoji", { status: 404 });
}
