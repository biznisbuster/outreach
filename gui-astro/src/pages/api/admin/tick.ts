/** POST /api/admin/tick — ručno pokreni scheduler tick. */
import type { APIRoute } from "astro";
import { ok } from "../../../lib/api";
import { processQueue } from "../../../lib/workers/scheduler";

export const POST: APIRoute = async () => {
  const result = await processQueue();
  return ok(result);
};
