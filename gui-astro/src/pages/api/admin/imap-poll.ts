/** POST /api/admin/imap-poll — ručno pokreni IMAP poll. */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../lib/api";
import { pollImap } from "../../../lib/email/imap";

export const POST: APIRoute = async () => {
  try {
    const r = await pollImap();
    return ok(r);
  } catch (e) {
    return bad(`IMAP greška: ${(e as Error).message}`);
  }
};
