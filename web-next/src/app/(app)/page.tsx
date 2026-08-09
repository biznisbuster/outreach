import Link from "next/link";
import { sql, desc, eq, and, gte } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getCallTodo } from "@/core/dashboard";
import { timeAgo, formatNumber } from "@/core/utils";
import { KanbanSquare, Mail, Inbox as InboxIcon, Users, ArrowRight, Phone } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const db = getDb();

  const [leadStats, emailStats, replyCount, campaignCount, recentLeads] = await Promise.all([
    db
      .select({
        total: sql<number>`count(*)`,
        withEmail: sql<number>`sum(case when ${schema.leads.email} is not null and ${schema.leads.email} != '' then 1 else 0 end)`,
        dnc: sql<number>`sum(case when ${schema.leads.doNotContact} then 1 else 0 end)`,
      })
      .from(schema.leads)
      .get(),
    db
      .select({
        queued: sql<number>`sum(case when ${schema.emailSends.status} in ('queued','sending') then 1 else 0 end)`,
        sent: sql<number>`sum(case when ${schema.emailSends.status} = 'sent' then 1 else 0 end)`,
        drafts: sql<number>`sum(case when ${schema.emailSends.status} = 'draft' then 1 else 0 end)`,
      })
      .from(schema.emailSends)
      .get(),
    db.select({ c: sql<number>`count(*)` }).from(schema.emailReplies).get(),
    db.select({ c: sql<number>`count(*)` }).from(schema.campaigns).get(),
    db
      .select()
      .from(schema.leads)
      .orderBy(desc(schema.leads.createdAt))
      .limit(6)
      .all(),
  ]);

  const statusRows = db
    .select({
      name: schema.statuses.name,
      color: schema.statuses.color,
      count: sql<number>`count(${schema.leads.id})`,
    })
    .from(schema.statuses)
    .leftJoin(schema.leads, eq(schema.leads.statusId, schema.statuses.id))
    .where(eq(schema.statuses.isActive, true))
    .groupBy(schema.statuses.id, schema.statuses.name, schema.statuses.color)
    .orderBy(schema.statuses.sortOrder)
    .all();

  const todos = await getCallTodo(5);

  const kpis = [
    { label: "Leadova", value: leadStats?.total ?? 0, href: "/leads", icon: KanbanSquare },
    { label: "Kampanja", value: campaignCount?.c ?? 0, href: "/campaigns", icon: Users },
    { label: "U redu slanja", value: emailStats?.queued ?? 0, href: "/queue", icon: Mail },
    { label: "Odgovora", value: replyCount?.c ?? 0, href: "/inbox", icon: InboxIcon },
  ];

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Pregled outreach aktivnosti</p>
        </div>
        <Button asChild>
          <Link href="/leads">
            Otvori leadove <ArrowRight />
          </Link>
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {kpis.map((k) => {
          const Icon = k.icon;
          return (
            <Link key={k.label} href={k.href} className="group">
              <Card className="card-hover h-full">
                <CardContent className="flex items-center gap-3 p-5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
                    <Icon className="size-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-2xl font-bold leading-tight">{formatNumber(k.value)}</div>
                    <div className="truncate text-sm text-muted-foreground">{k.label}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle>Po statusu</CardTitle>
            <CardDescription>Distribucija leadova</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {statusRows.length === 0 && <p className="text-sm text-muted-foreground">Nema aktivnih statusa.</p>}
            {statusRows.map((s) => (
              <div key={s.name} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
                <Badge variant="secondary">{formatNumber(s.count)}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Nedavno dodati leadovi</CardTitle>
            <CardDescription>Poslednjih {recentLeads.length} unosa</CardDescription>
          </CardHeader>
          <CardContent>
            {recentLeads.length === 0 ? (
              <EmptyState title="Nema leadova" description="Uvezi leadove iz kampanje ili Google Maps-a." />
            ) : (
              <div className="divide-y divide-border">
                {recentLeads.map((l) => (
                  <Link
                    key={l.id}
                    href={`/leads/${l.id}`}
                    className="flex items-center justify-between gap-3 py-2.5 transition-colors hover:bg-secondary/50"
                  >
                    <div className="min-w-0">
                      <div className="truncate font-medium">{l.name}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {[l.category, l.city].filter(Boolean).join(" · ") || "—"}
                      </div>
                    </div>
                    <div className="shrink-0 text-xs text-muted-foreground">{timeAgo(l.createdAt)}</div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {todos.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Phone className="size-4 text-muted-foreground" /> Za poziv
            </CardTitle>
            <CardDescription>Leadovi bez emaila, sa telefonom</CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {todos.map((t) => (
              <Link key={t.leadId} href={`/leads/${t.leadId}`} className="flex items-center justify-between py-2.5 hover:bg-secondary/50">
                <div className="min-w-0">
                  <div className="truncate font-medium">{t.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{t.city ?? "—"}</div>
                </div>
                <span className="shrink-0 font-mono text-sm text-muted-foreground">{t.phoneE164}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
