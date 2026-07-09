/** GET /api/audit — list audit entries. */
import type { APIRoute } from "astro";
import { ok, qpInt } from "../../lib/api";
import { listAudit } from "../../lib/audit";

export const GET: APIRoute = async ({ url }) => {
  const leadId = qpInt(url.searchParams.get("leadId"), 0);
  const entity = url.searchParams.get("entity") ?? undefined;
  const limit = Math.min(qpInt(url.searchParams.get("limit"), 100), 500);
  const offset = qpInt(url.searchParams.get("offset"), 0);
  const items = listAudit({
    ...(leadId ? { entityId: leadId, entity: "lead" } : {}),
    ...(entity ? { entity } : {}),
    limit,
    offset,
  });
  return ok({ items });
};
