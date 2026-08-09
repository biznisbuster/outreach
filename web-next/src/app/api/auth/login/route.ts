import { NextResponse } from "next/server";
import { ensureSingleUser, verifyPassword } from "@/core/auth";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE_SEC } from "@/core/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const callbackRaw = String(form.get("callbackUrl") ?? "/");
  const callback = callbackRaw.startsWith("/") && !callbackRaw.startsWith("//") ? callbackRaw : "/";

  await ensureSingleUser();

  if (!(await verifyPassword(password))) {
    const url = new URL("/login", req.url);
    url.searchParams.set("error", "Pogrešna šifra");
    url.searchParams.set("callbackUrl", callback);
    return NextResponse.redirect(url, 303);
  }

  const res = NextResponse.redirect(new URL(callback, req.url), 303);
  res.cookies.set(SESSION_COOKIE, createSessionToken("1"), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_MAX_AGE_SEC,
  });
  return res;
}
