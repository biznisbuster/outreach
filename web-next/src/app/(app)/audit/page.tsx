import { listAudit } from "@/core/audit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate } from "@/core/utils";
import { Activity } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<{ page?: string }>;
}

export default async function AuditPage({ searchParams }: Props) {
  const sp = await searchParams;
  const page = Math.max(1, Number(sp.page ?? "1") || 1);
  const limit = 100;
  const entries = listAudit({ limit, offset: (page - 1) * limit });

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Audit log</h1>
        <p className="text-sm text-muted-foreground">Istorija promena u sistemu</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="size-4 text-muted-foreground" /> Događaji
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {entries.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nema događaja" description="Promene nad leadovima, kampanjama i slanjem beleže se ovde." />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {entries.map((e) => (
                <div key={e.id} className="flex items-center justify-between gap-3 px-6 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono text-[11px]">
                        {e.action}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {e.entity}
                        {e.entity_id != null && ` #${e.entity_id}`}
                      </span>
                    </div>
                    {e.meta && (
                      <div className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {JSON.stringify(e.meta)}
                      </div>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{formatDate(e.ts)}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
