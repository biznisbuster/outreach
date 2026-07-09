/** GET — list draft attachments (override). POST — set list (zamenjuje). DELETE — ukloni sve (vrati na template default). */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../../../lib/api";
import {
  listDraftAttachments,
  setDraftAttachments,
} from "../../../../../lib/attachments";

export const GET: APIRoute = async ({ params }) => {
  const id = Number(params.id);
  if (!Number.isFinite(id)) return bad("Neispravan id");
  return ok({ items: listDraftAttachments(id) });
};

export const POST: APIRoute = async ({ params, request }) => {
  const emailSendId = Number(params.id);
  if (!Number.isFinite(emailSendId)) return bad("Neispravan email send id");
  const body = (await request.json().catch(() => null)) as { attachment_ids?: number[] } | null;
  if (!body || !Array.isArray(body.attachment_ids)) {
    return bad("Polje 'attachment_ids' (array of number) nedostaje");
  }
  setDraftAttachments(emailSendId, body.attachment_ids);
  return ok({ items: listDraftAttachments(emailSendId) });
};

export const DELETE: APIRoute = async ({ params }) => {
  const emailSendId = Number(params.id);
  if (!Number.isFinite(emailSendId)) return bad("Neispravan email send id");
  // Brisanje svih = set na prazno = override prazan = vrati na template default
  setDraftAttachments(emailSendId, []);
  return ok({ cleared: true });
};