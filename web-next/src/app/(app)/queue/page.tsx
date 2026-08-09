import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatNumber } from "@/core/utils";
import { QUEUE_STATUS_META, QUEUE_STATUS_ORDER } from "@/core/queueMeta";

export const dynamic = "force-dynamic";

const TONE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "info"> = {
  muted: "secondary",
  info: "info",
  primary: "default",
  success: "success",
  destructive: "destructive",
  warning: "warning",
};

export default async function QueuePage() {
  const db = getDb();

  const counts = db
    .select({
      status: schema.emailSends.status,
      c: sql<number>`count(*)`,
    })
    .from(schema.emailSends)
    .groupBy(schema.emailSends.status)
    .all();
  const countByStatus = new Map(counts.map((r) => [r.status, r.c]));

  const rows = db
    .select({
      id: schema.emailSends.id,
      subject: schema.emailSends.subject,
      status: schema.emailSends.status,
      queuedAt: schema.emailSends.queuedAt,
      sentAt: schema.emailSends.sentAt,
      leadId: schema.emailSends.leadId,
      leadName: schema.leads.name,
      senderEmail: schema.senders.email,
    })
    .from(schema.emailSends)
    .leftJoin(schema.leads, sql`${schema.emailSends.leadId} = ${schema.leads.id}`)
    .leftJoin(schema.senders, sql`${schema.emailSends.senderId} = ${schema.senders.id}`)
    .orderBy(desc(sql`COALESCE(${schema.emailSends.sentAt}, ${schema.emailSends.queuedAt})`))
    .limit(100)
    .all();

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Red slanja</h1>
        <p className="text-sm text-muted-foreground">Emailovi po statusu</p>
      </div>

      <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
        {QUEUE_STATUS_ORDER.map((s) => {
          const meta = QUEUE_STATUS_META[s];
          return (
            <Card key={s}>
              <CardContent className="p-4 text-center">
                <div className="text-2xl font-bold">{formatNumber(countByStatus.get(s) ?? 0)}</div>
                <div className="text-xs text-muted-foreground">{meta.label}</div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Poslednji emailovi</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Red slanja je prazan" description="Kreiraj draft ili uvezi leadove pa pokreni sekvencu." />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {rows.map((r) => {
                const meta = QUEUE_STATUS_META[r.status as keyof typeof QUEUE_STATUS_META];
                return (
                  <div key={r.id} className="flex items-center justify-between gap-3 px-6 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{r.subject}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {r.leadName ? (
                          <Link href={`/leads/${r.leadId}`} className="hover:underline">
                            {r.leadName}
                          </Link>
                        ) : (
                          "—"
                        )}
                        {r.senderEmail && <> · {r.senderEmail}</>}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {formatDate(r.sentAt ?? r.queuedAt)}
                      </span>
                      <Badge variant={meta ? TONE_VARIANT[meta.tone] ?? "secondary" : "secondary"}>{meta?.label ?? r.status}</Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
