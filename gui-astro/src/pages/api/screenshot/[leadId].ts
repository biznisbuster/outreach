/** GET /api/screenshot/[leadId] — servira screenshot fajl lead-a. */
import type { APIRoute } from "astro";
import { getDb, schema, notFound } from "../../../lib/api";
import { eq } from "drizzle-orm";
import fs from "node:fs";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.leadId);
  const db = getDb();
  const [screenshot] = db
    .select()
    .from(schema.screenshots)
    .where(eq(schema.screenshots.leadId, id))
    .all();
  if (!screenshot) return notFound("Screenshot ne postoji");

  // path: data/screenshots/...
  const candidates = [
    screenshot.path,
    `/data/screenshots/${screenshot.path.split("/").pop()}`,
    `${process.env.SCREENSHOTS_DIR ?? "../data/screenshots"}/${screenshot.path.split("/").pop()}`,
    `../data/screenshots/${screenshot.path.split("/").pop()}`,
  ];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        const buf = fs.readFileSync(c);
        return new Response(buf, { status: 200, headers: { "Content-Type": "image/png" } });
      }
    } catch {
      // continue
    }
  }
  return notFound("Screenshot fajl ne postoji");
};
