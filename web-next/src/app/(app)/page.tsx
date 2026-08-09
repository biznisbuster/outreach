import Link from "next/link";
import { count, eq, gte, and, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { KpiCard } from "@/components/kpi-card";
import { formatNumber } from "@/core/utils";
import { getCallTodo } from "@/core/dashboard";
import { Phone, AlertTriangle, UserPlus } from "lucide-react";

export const dynamic = "force-dynamic";

function sinceDays(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

export default async function DashboardPage() {
  const db = getDb();

  const totalLeads = Number(db.select({ c: count() }).from(schema.leads).all()[0]?.c ?? 0);
  const totalCampaigns = Number(db.select({ c: count() }).from(schema.campaigns).all()[0]?.c ?? 0);

  const sent7d = Number(
    db
      .select({ c: count() })
      .from(schema.emailSends)
      .where(and(eq(schema.emailSends.status, "sent"), gte(schema.emailSends.sentAt, sinceDays(7))))
      .all()[0]?.c ?? 0,
  );
  const sent30d = Number(
    db
      .select({ c: count() })
      .from(schema.emailSends)
      .where(and(eq(schema.emailSends.status, "sent"), gte(schema.emailSends.sentAt, sinceDays(30))))
      .all()[0]?.c ?? 0,
  );
  const replied30d = Number(
    db
      .select({ c: count() })
      .from(schema.emailSends)
      .where(
        and(
          eq(schema.emailSends.status, "sent"),
          gte(schema.emailSends.sentAt, sinceDays(30)),
          eq(schema.emailSends.replied, true),
        ),
      )
      .all()[0]?.c ?? 0,
  );
  const replyRate = sent30d > 0 ? Math.round((replied30d / sent30d) * 100) : 0;

  const queuedCount = Number(
    db.select({ c: count() }).from(schema.emailSends).where(eq(schema.emailSends.status, "queued")).all()[0]?.c ?? 0,
  );
  const draftsCount = Number(
    db.select({ c: count() }).from(schema.emailSends).where(eq(schema.emailSends.status, "draft")).all()[0]?.c ?? 0,
  );
  const leadsWithoutWebsite = Number(
    db
      .select({ c: count() })
      .from(schema.leads)
      .where(sql`${schema.leads.websiteNormalized} IS NULL`)
      .all()[0]?.c ?? 0,
  );

  const statusRows = db
    .select({ name: schema.statuses.name, color: schema.statuses.color, n: count() })
    .from(schema.leads)
    .innerJoin(schema.statuses, eq(schema.leads.statusId, schema.statuses.id))
    .groupBy(schema.statuses.id, schema.statuses.name, schema.statuses.color)
    .orderBy(sql`count() desc`)
    .limit(5)
    .all();
  const leadsWithStatus = statusRows.reduce((a, s) => a + Number(s.n), 0);

  const todoItems = await getCallTodo(20);

  const kpis = [
    {
      label: "Leadovi",
      value: formatNumber(totalLeads),
      hint: `${formatNumber(totalCampaigns)} kampanja`,
      icon: "users",
      tone: "primary" as const,
      href: "/leads",
    },
    {
      label: "Poslato (7d)",
      value: formatNumber(sent7d),
      hint: `${formatNumber(replied30d)} odgovora (30d)`,
      icon: "send",
      tone: "info" as const,
      href: "/queue",
    },
    {
      label: "Reply rate",
      value: sent30d > 0 ? `${replyRate}%` : "—",
      hint: "poslednjih 30 dana",
      icon: "trending-up",
      tone: "success" as const,
    },
    {
      label: "U redu",
      value: formatNumber(queuedCount),
      hint: `${formatNumber(draftsCount)} ${draftsCount === 1 ? "draft" : "draftova"}`,
      icon: "inbox",
      tone: "warning" as const,
      href: "/queue",
    },
  ];

  return (
    <div>
      <div className="border-b border-border px-4 py-3 md:px-6 md:py-4">
        <h1 className="text-lg font-bold tracking-tight md:text-xl">Dashboard</h1>
        <p className="text-xs text-muted-foreground md:text-sm">Pregled aktivnosti i to-do za danas</p>
      </div>

      <div className="space-y-6 px-4 pb-8 pt-5 md:px-6 md:pb-10 md:pt-6">
        <div className="grid auto-rows-fr gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {kpis.map((k) => (
            <KpiCard key={k.label} {...k} />
          ))}
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Phone className="size-4 text-primary" />
                  Za zvanje danas
                </CardTitle>
                <CardDescription>Follow-up koji kasni + aktivni leadovi bez kontakta 5+ dana</CardDescription>
              </div>
              <span className="text-sm font-medium text-muted-foreground">
                {todoItems.length} {todoItems.length === 1 ? "lead" : "leadova"}
              </span>
            </div>
          </CardHeader>
          <CardContent>
            {todoItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center text-sm text-muted-foreground">
                <Phone className="mb-2 size-10" />
                <p className="font-medium">Nema hitnih poziva.</p>
                <p>Svi aktivni leadovi su kontaktirani u poslednjih 5 dana.</p>
              </div>
            ) : (
              <div className="max-h-[20vh] divide-y divide-border overflow-y-auto">
                {todoItems.map((it) => (
                  <Link key={it.leadId} href={`/leads/${it.leadId}`} className="flex items-center gap-3 px-1 py-3 hover:bg-accent">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {it.name}
                        {it.statusName && it.statusColor && (
                          <span
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
                            style={{ background: `${it.statusColor}1a`, color: it.statusColor }}
                          >
                            {it.statusName}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {it.reason === "followup_due" ? "Follow-up" : "Bez kontakta"} · {it.daysOverdue}d
                        {it.city ? ` · ${it.city}` : ""}
                      </div>
                    </div>
                    {it.phoneE164 && (
                      <a
                        href={`tel:${it.phoneE164}`}
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex size-8 items-center justify-center rounded-md text-primary hover:bg-accent"
                        aria-label={`Pozovi ${it.name}`}
                      >
                        <Phone className="size-3.5" />
                      </a>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-2">
            <CardHeader>
              <CardTitle className="text-base">Leadovi po statusu</CardTitle>
              <CardDescription>
                {leadsWithStatus > 0 ? `${leadsWithStatus} leadova sa statusom` : "Nema leadova sa statusom"}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {statusRows.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <div className="mb-3 flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
                    <UserPlus className="size-5" />
                  </div>
                  <p className="font-medium">Nema leadova</p>
                  <p className="mb-3 text-sm text-muted-foreground">Dodaj leadove da počneš — ručno ili kroz import.</p>
                  <Link href="/leads" className="text-sm font-medium text-primary hover:underline">
                    Dodaj prvog klijenta
                  </Link>
                </div>
              ) : (
                <div className="space-y-3">
                  {statusRows.map((s) => {
                    const pct = leadsWithStatus > 0 ? Math.round((Number(s.n) / leadsWithStatus) * 100) : 0;
                    return (
                      <div key={s.name}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <div className="flex items-center gap-2">
                            <span className="size-2.5 rounded-full" style={{ background: s.color }} />
                            <span className="font-medium">{s.name}</span>
                          </div>
                          <span className="text-muted-foreground">
                            {formatNumber(s.n)} · {pct}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: s.color }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="size-4 text-amber-500" />
                Alerti
              </CardTitle>
              <CardDescription>Stvari koje treba obraditi</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {draftsCount > 0 && (
                <Link href="/queue" className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 transition-colors hover:bg-amber-100 dark:bg-warning-soft dark:hover:brightness-110">
                  <span className="text-amber-900 dark:text-warning">Draftova čeka na pregled</span>
                  <span className="font-semibold text-amber-900 dark:text-warning">{draftsCount}</span>
                </Link>
              )}
              {leadsWithoutWebsite > 0 && (
                <Link href="/campaigns" className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 transition-colors hover:bg-amber-100 dark:bg-warning-soft dark:hover:brightness-110">
                  <span className="text-amber-900 dark:text-warning">Leadova bez website-a</span>
                  <span className="font-semibold text-amber-900 dark:text-warning">{leadsWithoutWebsite}</span>
                </Link>
              )}
              {queuedCount > 0 && (
                <Link href="/queue" className="flex items-center justify-between rounded-md bg-amber-50 px-3 py-2 transition-colors hover:bg-amber-100 dark:bg-warning-soft dark:hover:brightness-110">
                  <span className="text-amber-900 dark:text-warning">Emailova u redu slanja</span>
                  <span className="font-semibold text-amber-900 dark:text-warning">{queuedCount}</span>
                </Link>
              )}
              {draftsCount === 0 && leadsWithoutWebsite === 0 && queuedCount === 0 && (
                <p className="py-4 text-center text-muted-foreground">Sve čisto. Nema hitnih obaveza.</p>
              )}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Brze akcije</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Link href="/campaigns" className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <span className="text-primary">↑</span> Uvezi CSV
              </Link>
              <Link href="/leads" className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <span className="text-primary">+</span> Dodaj ručno
              </Link>
              <Link href="/campaigns" className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <span className="text-primary">👥</span> Otvori kampanje
              </Link>
              <Link href="/templates" className="flex items-center gap-2 rounded-md border border-border p-3 text-sm font-medium transition-colors hover:bg-accent">
                <span className="text-primary">📄</span> Uredi šablone
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
