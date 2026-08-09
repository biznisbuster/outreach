import Link from "next/link";
import { sql, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { formatDate, formatNumber } from "@/core/utils";
import { Users, Plus } from "lucide-react";
import { createCampaign } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const db = getDb();
  const rows = db
    .select({
      id: schema.campaigns.id,
      name: schema.campaigns.name,
      category: schema.campaigns.category,
      city: schema.campaigns.city,
      createdAt: schema.campaigns.createdAt,
      leadCount: sql<number>`count(${schema.leads.id})`,
      emailCount: sql<number>`sum(case when ${schema.leads.email} is not null and ${schema.leads.email} != '' then 1 else 0 end)`,
    })
    .from(schema.campaigns)
    .leftJoin(schema.leads, eq(schema.leads.campaignId, schema.campaigns.id))
    .groupBy(schema.campaigns.id)
    .orderBy(desc(schema.campaigns.createdAt))
    .all();

  return (
    <div>
      <PageHeader title="Kampanje" subtitle={`${formatNumber(rows.length)} kampanja`} />
      <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plus className="size-4 text-muted-foreground" /> Nova kampanja
          </CardTitle>
          <CardDescription>Naziv se automatski izvodi iz kategorije i grada</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createCampaign} className="flex flex-wrap items-end gap-3">
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="category">Kategorija</Label>
              <Input id="category" name="category" required placeholder="Cvećara" />
            </div>
            <div className="min-w-40 flex-1 space-y-1.5">
              <Label htmlFor="city">Grad</Label>
              <Input id="city" name="city" required placeholder="Kruševac" />
            </div>
            <Button type="submit">Kreiraj</Button>
          </form>
        </CardContent>
      </Card>

      {rows.length === 0 ? (
        <EmptyState title="Nema kampanja" description="Kreiraj kampanju da bi počeo sa uvozom leadova." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {rows.map((c) => (
            <Link key={c.id} href={`/campaigns/${c.id}`}>
              <Card className="card-hover h-full">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-9 items-center justify-center rounded-lg bg-primary-soft text-accent-foreground">
                        <Users className="size-4" />
                      </div>
                      <div>
                        <div className="font-semibold">{c.name}</div>
                        <div className="text-sm text-muted-foreground">
                          {[c.category, c.city].filter(Boolean).join(" · ") || "—"}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center gap-2">
                    <Badge variant="secondary">{formatNumber(c.leadCount)} leadova</Badge>
                    <Badge variant="info">{formatNumber(c.emailCount ?? 0)} sa emailom</Badge>
                    <span className="ml-auto text-xs text-muted-foreground">{formatDate(c.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
      </div>
    </div>
  );
}
