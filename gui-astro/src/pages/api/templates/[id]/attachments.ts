/** GET — list template attachments. POST — veži. DELETE — odveži. */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../../lib/api";
import {
  listTemplateAttachments,
  attachToTemplate,
  detachFromTemplate,
} from "../../../../lib/attachments";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return bad("Neispravan id");
  return ok({ items: listTemplateAttachments(id) });
};

export const POST: APIRoute = async ({ params, request }) => {
  const templateId = Number(params.id);
  if (!Number.isFinite(templateId)) return bad("Neispravan template id");
  const body = (await request.json().catch(() => null)) as { attachment_id?: number } | null;
  if (!body || typeof body.attachment_id !== "number") {
    return bad("Polje 'attachment_id' nedostaje");
  }
  const r = attachToTemplate(templateId, body.attachment_id);
  if (!r.ok) return bad(r.error || "Attach neuspešno");
  return ok({ attached: true });
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const templateId = Number(params.id);
  if (!Number.isFinite(templateId)) return bad("Neispravan template id");
  const body = (await request.json().catch(() => null)) as { attachment_id?: number } | null;
  if (!body || typeof body.attachment_id !== "number") {
    return bad("Polje 'attachment_id' nedostaje");
  }
  detachFromTemplate(templateId, body.attachment_id);
  return ok({ detached: true });
};