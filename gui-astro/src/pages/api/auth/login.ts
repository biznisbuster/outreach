import type { APIRoute } from "astro";
import { verifyPassword } from "../../../lib/auth";
import { writeSession } from "../../../lib/session";

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const form = await request.formData();
  const password = String(form.get("password") ?? "");
  const callback = String(form.get("callbackUrl") ?? "/") || "/";

  if (!password) {
    return redirect(`/login?error=${encodeURIComponent("Šifra je obavezna")}`);
  }

  const ok = await verifyPassword(password).catch(() => false);
  if (!ok) {
    return redirect(`/login?error=${encodeURIComponent("Pogrešna šifra")}`);
  }

  writeSession(cookies, "1");
  return redirect(callback);
};
