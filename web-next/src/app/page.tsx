import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { parseSessionToken, SESSION_COOKIE } from "@/core/session";

export default async function DashboardPage() {
  const store = await cookies();
  if (!parseSessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/login");

  const db = getDb();
  const [{ leadCount }] = db
    .select({ leadCount: sql<number>`count(*)` })
    .from(schema.leads)
    .all();
  const [{ campaignCount }] = db
    .select({ campaignCount: sql<number>`count(*)` })
    .from(schema.campaigns)
    .all();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col gap-6 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Outreach</h1>
          <p className="text-sm text-muted-foreground">Next.js refactor u toku</p>
        </div>
        <form method="POST" action="/api/auth/logout">
          <button
            type="submit"
            className="press inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium text-card-foreground shadow-sm transition-colors hover:bg-secondary"
          >
            Odjava
          </button>
        </form>
      </header>

      <section className="rounded-xl border border-border bg-card p-6 text-card-foreground shadow-sm">
        <h2 className="font-semibold">Faza 1 završena</h2>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          Core sloj je aktivan: isti SQLite, ista šema ({leadCount} leadova,{" "}
          {campaignCount} kampanja u postojećoj bazi), HMAC sesija i auth guard rade.
          Sledeći korak: dizajn sistem i leads tabela.
        </p>
      </section>
    </main>
  );
}
