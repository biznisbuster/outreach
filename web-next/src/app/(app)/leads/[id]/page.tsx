import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
import { formatDate, formatPhone, timeAgo } from "@/core/utils";
import { getLatestAuditForLead } from "@/core/siteAudit";
import { queueStatusMeta } from "@/core/queueMeta";
import {
  setLeadStatus,
  addLeadComment,
  blockLead,
  unblockLead,
  deleteLead,
  triggerLeadScrape,
  runSiteAudit,
} from "./actions";
import { Globe, Mail, Phone, MapPin, Star, MessageSquare, Trash2, Ban, CheckCircle2, RefreshCw, Gauge } from "lucide-react";

export const dynamic = "force-dynamic";

const TONE_VARIANT: Record<string, "default" | "secondary" | "success" | "warning" | "destructive" | "info"> = {
  muted: "secondary",
  info: "info",
  primary: "default",
  success: "success",
  destructive: "destructive",
  warning: "warning",
};

interface Props {
  params: Promise<{ id: string }>;
}

export default async function LeadDetailPage({ params }: Props) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) notFound();

  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead) notFound();

  const [statuses, comments, emails, campaign, latestAudit, screenshot] = await Promise.all([
    Promise.resolve(db.select().from(schema.statuses).orderBy(schema.statuses.sortOrder).all()),
    Promise.resolve(db.select().from(schema.comments).where(eq(schema.comments.leadId, id)).orderBy(desc(schema.comments.createdAt)).all()),
    Promise.resolve(db.select().from(schema.emailSends).where(eq(schema.emailSends.leadId, id)).orderBy(desc(schema.emailSends.id)).limit(10).all()),
    Promise.resolve(lead.campaignId ? db.select().from(schema.campaigns).where(eq(schema.campaigns.id, lead.campaignId)).get() : undefined),
    Promise.resolve(getLatestAuditForLead(id)),
    Promise.resolve(db.select().from(schema.screenshots).where(eq(schema.screenshots.leadId, id)).orderBy(desc(schema.screenshots.capturedAt)).get()),
  ]);

  const audit = latestAudit;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Link href="/leads" className="hover:underline">
              Leadovi
            </Link>
            <span>/</span>
            <span>#{lead.id}</span>
          </div>
          <h1 className="mt-1 truncate text-2xl font-bold tracking-tight">{lead.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {lead.category && <span>{lead.category}</span>}
            {lead.city && (
              <>
                <span>·</span>
                <span>{lead.city}</span>
              </>
            )}
            {campaign && (
              <>
                <span>·</span>
                <span>{campaign.name}</span>
              </>
            )}
          </div>
        </div>
        {lead.doNotContact ? (
          <Badge variant="destructive">Ne kontaktirati</Badge>
        ) : (
          <Badge variant="success">Kontakt aktivan</Badge>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle>Kontakt podaci</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <div className="flex items-center gap-2 text-sm">
                <Mail className="size-4 text-muted-foreground" />
                {lead.email ? <a href={`mailto:${lead.email}`} className="hover:underline">{lead.email}</a> : <span className="text-muted-foreground">Nema email</span>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Phone className="size-4 text-muted-foreground" />
                {lead.phoneE164 ? <span className="font-mono">{formatPhone(lead.phoneE164)}</span> : <span className="text-muted-foreground">Nema telefon</span>}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <Globe className="size-4 text-muted-foreground" />
                {lead.websiteNormalized ? (
                  <a href={`https://${lead.websiteNormalized}`} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {lead.websiteNormalized}
                  </a>
                ) : (
                  <span className="text-muted-foreground">Nema sajt</span>
                )}
              </div>
              <div className="flex items-center gap-2 text-sm">
                <MapPin className="size-4 text-muted-foreground" />
                {[lead.address, lead.city].filter(Boolean).join(", ") || <span className="text-muted-foreground">Nema adrese</span>}
              </div>
              {lead.googleRating != null && (
                <div className="flex items-center gap-2 text-sm">
                  <Star className="size-4 text-warning" />
                  {lead.googleRating} ({formatPhone(String(lead.reviewsCount ?? 0))} recenzija)
                </div>
              )}
            </CardContent>
          </Card>

          {audit && (
            <Card>
              <CardHeader>
                <CardTitle>Poslednji site audit</CardTitle>
                <CardDescription>{timeAgo(audit.createdAt)}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="text-3xl font-bold">{audit.overallRank}</div>
                  <Badge variant={audit.overallRank >= 71 ? "success" : audit.overallRank >= 56 ? "info" : "destructive"}>
                    {audit.verdictLabel ?? audit.verdict}
                  </Badge>
                </div>
                {audit.pitchAdvice && <p className="mt-3 text-sm text-muted-foreground">{audit.pitchAdvice}</p>}
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="size-4 text-muted-foreground" /> Komentari
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {comments.length === 0 && <p className="text-sm text-muted-foreground">Nema komentara.</p>}
              {comments.map((c) => (
                <div key={c.id} className="rounded-lg bg-secondary/60 p-3">
                  <p className="text-sm">{c.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{timeAgo(c.createdAt)}</p>
                </div>
              ))}
              <form action={addLeadComment} className="space-y-2">
                <input type="hidden" name="id" value={lead.id} />
                <Textarea name="body" placeholder="Dodaj komentar…" required />
                <Button type="submit" size="sm">
                  Dodaj komentar
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Poslati emailovi</CardTitle>
              <CardDescription>Poslednjih {emails.length}</CardDescription>
            </CardHeader>
            <CardContent>
              {emails.length === 0 ? (
                <EmptyState title="Nema emailova" description="Za ovog lead-a još nije poslat nijedan email." />
              ) : (
                <div className="divide-y divide-border">
                  {emails.map((e) => {
                    const meta = queueStatusMeta(e.status);
                    return (
                      <div key={e.id} className="flex items-center justify-between gap-3 py-2.5">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{e.subject}</div>
                          <div className="text-xs text-muted-foreground">
                            {e.sentAt ? formatDate(e.sentAt) : e.queuedAt ? `Queued ${formatDate(e.queuedAt)}` : "Draft"}
                          </div>
                        </div>
                        <Badge variant={meta ? TONE_VARIANT[meta.tone] ?? "secondary" : "secondary"}>
                          {meta?.label ?? e.status}
                        </Badge>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={setLeadStatus} className="space-y-2">
                <input type="hidden" name="id" value={lead.id} />
                <Select name="statusId" defaultValue={lead.statusId?.toString() ?? ""}>
                  <option value="">Bez statusa</option>
                  {statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" size="sm" className="w-full">
                  Sačuvaj status
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Akcije</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <form action={triggerLeadScrape}>
                <input type="hidden" name="id" value={lead.id} />
                <Button type="submit" variant="outline" className="w-full" disabled={!lead.websiteNormalized}>
                  <RefreshCw /> Skrejpuj sajt
                </Button>
              </form>
              <form action={runSiteAudit}>
                <input type="hidden" name="id" value={lead.id} />
                <Button type="submit" variant="outline" className="w-full" disabled={!lead.websiteNormalized}>
                  <Gauge /> Pokreni site audit
                </Button>
              </form>
              {screenshot && (
                <Button variant="outline" className="w-full" asChild>
                  <a href={`/api/screenshot/${lead.id}`} target="_blank" rel="noopener noreferrer">
                    Pogledaj screenshot
                  </a>
                </Button>
              )}
              {lead.doNotContact ? (
                <form action={unblockLead}>
                  <input type="hidden" name="id" value={lead.id} />
                  <Button type="submit" variant="outline" className="w-full">
                    <CheckCircle2 /> Odblokiraj
                  </Button>
                </form>
              ) : (
                <form action={blockLead}>
                  <input type="hidden" name="id" value={lead.id} />
                  <Button type="submit" variant="outline" className="w-full">
                    <Ban /> Blokiraj
                  </Button>
                </form>
              )}
              <form action={deleteLead}>
                <input type="hidden" name="id" value={lead.id} />
                <Button type="submit" variant="destructive" className="w-full">
                  <Trash2 /> Obriši lead
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meta</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1.5 text-sm text-muted-foreground">
              <div>Uvezen: {lead.importedAt ? formatDate(lead.importedAt) : "—"}</div>
              <div>Izvor: {lead.source ?? "—"}</div>
              <div>Ažuriran: {timeAgo(lead.updatedAt)}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
