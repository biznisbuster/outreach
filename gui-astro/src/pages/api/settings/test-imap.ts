/** POST /api/settings/test-imap — test IMAP konekcije. */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../lib/api";
import { ImapFlow } from "imapflow";
import { getSetting, getSettingBool } from "../../../lib/settings";

export const POST: APIRoute = async () => {
  const host = getSetting("imap_host");
  const user = getSetting("imap_user");
  const pass = getSetting("imap_password");
  const port = Number(getSetting("imap_port") || 993);
  const secure = getSettingBool("imap_secure");

  if (!host || !user || !pass) return bad("IMAP podešavanja nisu kompletna");

  const client = new ImapFlow({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: false,
  });
  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");
    try {
      // empty
    } finally {
      lock.release();
    }
    await client.logout();
    return ok({ ok: true });
  } catch (e) {
    return bad(`IMAP greška: ${(e as Error).message}`, 502);
  }
};
