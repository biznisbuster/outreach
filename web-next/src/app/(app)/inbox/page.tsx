import Link from "next/link";
import { desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/page-header";
import { formatDate } from "@/core/utils";
import { Inbox as InboxIcon } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const db = getDb();

  const replies = db
    .select({
      id: schema.emailReplies.id,
      fromEmail: schema.emailReplies.fromEmail,
      subject: schema.emailReplies.subject,
      body: schema.emailReplies.body,
      receivedAt: schema.emailReplies.receivedAt,
      matchedBy: schema.emailReplies.matchedBy,
      leadId: schema.emailReplies.leadId,
      leadName: schema.leads.name,
    })
    .from(schema.emailReplies)
    .leftJoin(schema.leads, sql`${schema.emailReplies.leadId} = ${schema.leads.id}`)
    .orderBy(desc(schema.emailReplies.receivedAt))
    .limit(100)
    .all();

  return (
    <div>
      <PageHeader title="Inbox" subtitle="Primljeni odgovori (IMAP reply tracking)" />
      <div className="space-y-4 p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <InboxIcon className="size-4 text-muted-foreground" /> Odgovori
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {replies.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="Nema odgovora"
                description="Kada primalac odgovori na poslati email, odgovor će se pojaviti ovde."
              />
            </div>
          ) : (
            <div className="divide-y divide-border">
              {replies.map((r) => (
                <div key={r.id} className="px-6 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-medium">{r.subject ?? "(bez naslova)"}</div>
                      <div className="truncate text-sm text-muted-foreground">
                        {r.fromEmail}
                        {r.leadName && (
                          <>
                            {" · "}
                            <Link href={`/leads/${r.leadId}`} className="text-primary hover:underline">
                              {r.leadName}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {r.matchedBy && <Badge variant="outline">{r.matchedBy}</Badge>}
                      <span className="text-xs text-muted-foreground">{formatDate(r.receivedAt)}</span>
                    </div>
                  </div>
                  {r.body && <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-muted-foreground">{r.body}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
