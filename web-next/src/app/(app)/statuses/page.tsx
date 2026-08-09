import { sql, eq } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/page-header";
import { formatNumber } from "@/core/utils";
import { createStatus, deleteStatus } from "./actions";
import { Trash2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function StatusesPage() {
  const db = getDb();
  const statuses = db
    .select({
      id: schema.statuses.id,
      name: schema.statuses.name,
      color: schema.statuses.color,
      sortOrder: schema.statuses.sortOrder,
      systemDefault: schema.statuses.systemDefault,
      isTerminalWon: schema.statuses.isTerminalWon,
      isTerminalLost: schema.statuses.isTerminalLost,
      leadCount: sql<number>`count(${schema.leads.id})`,
    })
    .from(schema.statuses)
    .leftJoin(schema.leads, eq(schema.leads.statusId, schema.statuses.id))
    .groupBy(schema.statuses.id)
    .orderBy(schema.statuses.sortOrder)
    .all();

  return (
    <div>
      <PageHeader title="Statusi" subtitle="Pipeline statusi za leadove" />
      <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Postojeći statusi</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {statuses.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 rounded-lg border border-border px-3 py-2.5">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
                  <span className="truncate font-medium">{s.name}</span>
                  {s.isTerminalWon && <Badge variant="success">Dobijeno</Badge>}
                  {s.isTerminalLost && <Badge variant="destructive">Izgubljeno</Badge>}
                  {s.systemDefault && <Badge variant="outline">Sistemski</Badge>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="text-sm text-muted-foreground">{formatNumber(s.leadCount)}</span>
                  {!s.systemDefault && (
                    <form action={deleteStatus}>
                      <input type="hidden" name="id" value={s.id} />
                      <Button type="submit" variant="ghost" size="icon" aria-label={`Obriši status ${s.name}`}>
                        <Trash2 />
                      </Button>
                    </form>
                  )}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Novi status</CardTitle>
            <CardDescription>Dodaj status u pipeline</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={createStatus} className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="name">Naziv statusa</Label>
                <Input id="name" name="name" required placeholder="Kontaktiran" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="color">Boja</Label>
                <Input id="color" name="color" type="color" defaultValue="#6b7280" className="h-10 p-1" />
              </div>
              <Button type="submit" className="w-full">
                Dodaj status
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
