import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatNumber } from "@/core/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function CampaignDetailPage({ params }: Props) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) notFound();

  const db = getDb();
  const campaign = db.select().from(schema.campaigns).where(eq(schema.campaigns.id, id)).get();
  if (!campaign) notFound();

  const stats = db
    .select({
      total: sql<number>`count(*)`,
      withEmail: sql<number>`sum(case when ${schema.leads.email} is not null and ${schema.leads.email} != '' then 1 else 0 end)`,
      sent: sql<number>`(SELECT count(*) FROM email_sends es JOIN leads l ON l.id = es.lead_id WHERE l.campaign_id = ${id} AND es.status = 'sent')`,
    })
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, id))
    .get();

  const statusDist = db
    .select({
      name: schema.statuses.name,
      color: schema.statuses.color,
      count: sql<number>`count(${schema.leads.id})`,
    })
    .from(schema.leads)
    .innerJoin(schema.statuses, eq(schema.leads.statusId, schema.statuses.id))
    .where(eq(schema.leads.campaignId, id))
    .groupBy(schema.statuses.id, schema.statuses.name, schema.statuses.color)
    .all();

  const recentLeads = db
    .select()
    .from(schema.leads)
    .where(eq(schema.leads.campaignId, id))
    .orderBy(desc(schema.leads.createdAt))
    .limit(10)
    .all();

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link href="/campaigns">
            <ArrowLeft /> Sve kampanje
          </Link>
        </Button>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">{campaign.name}</h1>
        <p className="text-sm text-muted-foreground">
          {[campaign.category, campaign.city].filter(Boolean).join(" · ") || "Bez kategorije"} · kreirana{" "}
          {formatDate(campaign.createdAt)}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-bold">{formatNumber(stats?.total ?? 0)}</div>
            <div className="text-sm text-muted-foreground">Leadova</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-bold">{formatNumber(stats?.withEmail ?? 0)}</div>
            <div className="text-sm text-muted-foreground">Sa emailom</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 text-center">
            <div className="text-3xl font-bold">{formatNumber(stats?.sent ?? 0)}</div>
            <div className="text-sm text-muted-foreground">Poslatih emailova</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Statusi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {statusDist.length === 0 && <p className="text-sm text-muted-foreground">Nema leadova sa statusom.</p>}
            {statusDist.map((s) => (
              <div key={s.name} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm">
                  <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                  {s.name}
                </span>
                <Badge variant="secondary">{s.count}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Poslednji leadovi</CardTitle>
            <CardDescription>
              <Link href={`/leads?campaignId=${campaign.id}`} className="text-primary hover:underline">
                Vidi sve u leads tabeli
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent className="divide-y divide-border">
            {recentLeads.map((l) => (
              <Link key={l.id} href={`/leads/${l.id}`} className="flex items-center justify-between py-2.5 hover:bg-secondary/50">
                <div className="min-w-0">
                  <div className="truncate font-medium">{l.name}</div>
                  <div className="truncate text-sm text-muted-foreground">{l.email ?? "bez emaila"}</div>
                </div>
                <span className="text-xs text-muted-foreground">{formatDate(l.createdAt)}</span>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
