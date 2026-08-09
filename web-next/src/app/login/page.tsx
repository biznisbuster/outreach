import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { parseSessionToken, SESSION_COOKIE } from "@/core/session";

export const metadata: Metadata = { title: "Prijava" };

interface Props {
  searchParams: Promise<{ error?: string; callbackUrl?: string }>;
}

export default async function LoginPage({ searchParams }: Props) {
  const store = await cookies();
  if (parseSessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/");

  const params = await searchParams;
  const callback =
    params.callbackUrl?.startsWith("/") && !params.callbackUrl.startsWith("//")
      ? params.callbackUrl
      : "/";

  return (
    <div className="flex min-h-dvh items-center justify-center p-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-card text-card-foreground shadow-lg">
        <div className="flex flex-col items-center space-y-2 p-6 text-center">
          <div className="mb-2 flex h-14 w-14 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-violet-500 text-primary-foreground shadow-md shadow-primary/30">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="26"
              height="26"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">Unesi šifru za pristup</p>
        </div>
        <div className="p-6 pt-0">
          <form method="POST" action="/api/auth/login" className="space-y-4">
            <input type="hidden" name="callbackUrl" value={callback} />
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-sm font-medium">
                Šifra
              </label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoFocus
                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-xs transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-primary"
              />
            </div>
            {params.error && (
              <div
                className="rounded-md border border-destructive/30 bg-destructive-soft px-3 py-2 text-sm text-destructive"
                role="alert"
              >
                {params.error}
              </div>
            )}
            <button
              type="submit"
              className="press inline-flex h-9 w-full items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-all hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Uđi
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
