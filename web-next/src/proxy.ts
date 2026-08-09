import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { parseSessionToken, SESSION_COOKIE } from "@/core/session";

/**
 * Auth guard: čisti HMAC cookie (bez DB poziva — proxy radi pre route-a).
 * Next 16: proxy.ts runs on the Node.js runtime by default.
 */
export function proxy(req: NextRequest) {
  const session = parseSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!session) {
    const login = new URL("/login", req.url);
    login.searchParams.set("callbackUrl", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Sve OSIM: login, auth API, unsubscribe (javni link iz emaila),
     * statika (_next/static, _next/image), favicon i asset ekstenzije.
     */
    "/((?!login|api/auth|api/unsubscribe|_next/static|_next/image|favicon.ico|favicon.svg|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|css|js|map|txt|woff2?)$).*)",
  ],
};
