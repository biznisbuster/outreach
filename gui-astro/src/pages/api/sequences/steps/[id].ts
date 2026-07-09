/** DELETE /api/sequences/steps/[id]. */
import type { APIRoute } from "astro";
import { getDb, schema, ok } from "../../../../lib/api";
import { eq } from "drizzle-orm";

export const DELETE: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  const db = getDb();
  db.delete(schema.sequenceSteps).where(eq(schema.sequenceSteps.id, id)).run();
  return ok({ ok: true });
};
