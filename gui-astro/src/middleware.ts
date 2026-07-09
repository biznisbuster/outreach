import { defineMiddleware } from "astro:middleware";
import { readSession } from "./lib/session";
import { ensureSeed } from "./lib/seed";

const PUBLIC_PREFIXES = ["/login", "/api/auth/", "/api/unsubscribe", "/_image", "/favicon"];

const PUBLIC_API: string[] = ["/api/auth/login", "/api/auth/logout"];

export const onRequest = defineMiddleware(async (ctx, next) => {
  const { url, cookies, redirect } = ctx;
  const pathname = url.pathname;

  // Seeduj bazu pri prvoj interakciji (korisnik ili API)
  // Ne blokiramo ako baza/seed pukne — nastavljamo i logujemo.
  try {
    await ensureSeed();
  } catch (e) {
    console.error("[middleware] seed greška:", e);
  }

  if (
    pathname === "/login" ||
    PUBLIC_PREFIXES.some((p) => pathname.startsWith(p)) ||
    PUBLIC_API.includes(pathname)
  ) {
    return next();
  }

  const session = readSession(cookies);
  if (!session) {
    if (pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return redirect("/login");
  }

  ctx.locals.user = { id: session.userId };
  return next();
});
