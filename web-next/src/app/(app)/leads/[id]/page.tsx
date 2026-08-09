import Link from "next/link";
import { notFound } from "next/navigation";
import { eq, desc } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { EditableField } from "@/components/leads/editable-field";
import { StatusSelect } from "@/components/leads/status-select";
import { getLatestAuditForLead, getAuditMetrics, listAuditsForLead } from "@/core/siteAudit";
import { formatDate, timeAgo, cn } from "@/core/utils";
import { blockLead, unblockLead, deleteLead, triggerLeadScrape, runSiteAudit, addLeadComment } from "./actions";
import {
  ExternalLink,
  Ban,
  Check,
  Globe,
  RefreshCw,
  Search,
  MapPin,
  TriangleAlert,
  Trash2,
  ChevronDown,
} from "lucide-react";

export const dynamic = "force-dynamic";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}

function rankBadgeCls(rank: number): string {
  if (rank >= 86) return "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300";
  if (rank >= 71) return "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300";
  if (rank >= 56) return "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300";
  if (rank >= 31) return "bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300";
  return "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
}

export default async function LeadDetailPage({ params, searchParams }: Props) {
  const { id: idRaw } = await params;
  const id = Number(idRaw);
  if (!Number.isFinite(id)) notFound();

  const db = getDb();
  const row = db
    .select({
      lead: schema.leads,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      campaignName: schema.campaigns.name,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.statuses.id, schema.leads.statusId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(eq(schema.leads.id, id))
    .get();
  if (!row) notFound();

  const lead = row.lead;
  const comments = db.select().from(schema.comments).where(eq(schema.comments.leadId, id)).orderBy(desc(schema.comments.createdAt)).all();
  const scrapes = db.select().from(schema.siteScrapes).where(eq(schema.siteScrapes.leadId, id)).all();
  const screenshots = db.select().from(schema.screenshots).where(eq(schema.screenshots.leadId, id)).all();
  const emailSends = db.select().from(schema.emailSends).where(eq(schema.emailSends.leadId, id)).orderBy(desc(schema.emailSends.queuedAt)).all();
  const statuses = db.select().from(schema.statuses).orderBy(schema.statuses.sortOrder).all();
  const blocked = db.select().from(schema.blocklist).where(eq(schema.blocklist.leadId, id)).all().length > 0;

  const auditReport = getLatestAuditForLead(id);
  const auditMetrics = auditReport ? getAuditMetrics(auditReport.id) : [];
  const auditHistory = listAuditsForLead(id, 5);

  const sp = await searchParams;
  const activeTab: "overview" | "audit" = sp.tab === "audit" ? "audit" : "overview";

  const searchQ = [lead.name, lead.city].filter(Boolean).join(" ");
  const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQ)}`;

  return (
    <div>
      {/* Header */}
      <div className="border-b border-border bg-card px-4 py-3 md:px-6 md:py-4">
        <div className="flex items-center justify-between gap-3">
          <Link href="/leads" className="text-xs text-muted-foreground hover:underline">
            ← Leadovi
          </Link>
          {blocked && (
            <span className="inline-flex items-center rounded-full bg-red-100 px-3 py-1 text-xs font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
              Blokiran
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              <a href={googleSearchUrl} target="_blank" rel="noopener noreferrer" className="hover:text-primary hover:underline" title={`Google pretraga za "${searchQ}"`}>
                {lead.name}
                <ExternalLink className="ml-1 inline size-4 -translate-y-0.5 text-muted-foreground" />
              </a>
            </h1>
            {(lead.category || lead.city) && (
              <span className="mt-1 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs font-medium text-foreground/80">
                {lead.category && <span>{lead.category}</span>}
                {lead.category && lead.city && <span className="text-muted-foreground">—</span>}
                {lead.city && <span>{lead.city}</span>}
              </span>
            )}
            <p className="mt-1.5 text-sm text-muted-foreground">
              {row.campaignName ? (
                <Link href={`/campaigns/${lead.campaignId}`} className="hover:underline">
                  {row.campaignName}
                </Link>
              ) : (
                "Bez kampanje"
              )}
              {lead.address ? ` · ${lead.address}` : ""}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <StatusSelect leadId={id} initial={lead.statusId} statuses={statuses} />
            <details className="group relative">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center justify-center gap-1 rounded-md border border-destructive/30 bg-destructive-soft px-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 [&::-webkit-details-marker]:hidden">
                <TriangleAlert className="size-3.5" />
                <ChevronDown className="size-2.5 transition-transform group-open:rotate-180" />
              </summary>
              <div className="absolute right-0 top-11 z-50 w-56 origin-top-right rounded-lg border border-destructive/30 bg-card p-4 shadow-2xl ring-1 ring-black/5">
                <div className="mb-3 flex items-start gap-2">
                  <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Obriši ovog leada?</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">Briše i sve komentare, screenshot-ove, emailove i audit.</p>
                  </div>
                </div>
                <form action={deleteLead}>
                  <input type="hidden" name="id" value={id} />
                  <Button type="submit" variant="destructive" size="sm" className="w-full">
                    <Trash2 /> Da, obriši
                  </Button>
                </form>
              </div>
            </details>
          </div>
        </div>
      </div>

      {/* Sticky tab nav + akcije */}
      <div className="z-30 -mt-px border-b border-border bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 md:sticky md:top-0">
        <div className="flex h-11 items-center gap-1 overflow-x-auto px-4 md:px-6">
          <nav className="flex items-center gap-1" role="tablist" aria-label="Lead tabs">
            <Link
              href={`/leads/${id}`}
              aria-selected={activeTab === "overview"}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                activeTab === "overview" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Overview
            </Link>
            <Link
              href={`/leads/${id}?tab=audit`}
              aria-selected={activeTab === "audit"}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                activeTab === "audit" ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              Site Audit
              {auditReport && (
                <span className={cn("inline-flex h-5 min-w-[28px] items-center justify-center rounded-md px-1.5 text-[11px] font-semibold tabular-nums", rankBadgeCls(auditReport.overallRank))}>
                  {auditReport.overallRank}
                </span>
              )}
            </Link>
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            {blocked ? (
              <form action={unblockLead}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="inline-flex size-9 items-center justify-center rounded-md border border-success/30 bg-success-soft text-success transition-colors hover:bg-success/10" title="Odblokiraj" aria-label="Odblokiraj">
                  <Check className="size-3.5" />
                </button>
              </form>
            ) : (
              <form action={blockLead}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="inline-flex size-9 items-center justify-center rounded-md border border-destructive/30 bg-destructive-soft text-destructive transition-colors hover:bg-destructive/10" title="Blokiraj (do_not_contact)" aria-label="Blokiraj">
                  <Ban className="size-3.5" />
                </button>
              </form>
            )}

            {lead.websiteNormalized && (
              <a href={`https://${lead.websiteNormalized}`} target="_blank" rel="noopener noreferrer" className="inline-flex size-9 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm transition-all hover:brightness-110" title="Idi na sajt" aria-label="Idi na sajt">
                <Globe className="size-3.5" />
              </a>
            )}
            {lead.websiteNormalized && (
              <form action={triggerLeadScrape}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="inline-flex size-9 items-center justify-center rounded-md border border-primary bg-primary text-primary-foreground shadow-sm transition-all hover:brightness-110" title="Pokreni scrape sajta" aria-label="Pokreni scrape sajta">
                  <RefreshCw className="size-4" />
                </button>
              </form>
            )}
            {lead.websiteNormalized && (
              <form action={runSiteAudit}>
                <input type="hidden" name="id" value={id} />
                <button type="submit" className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-accent" title="Pokreni site audit" aria-label="Pokreni site audit">
                  <span className="text-xs font-bold">A</span>
                </button>
              </form>
            )}
            <a href={googleSearchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-accent" title="Google pretraga" aria-label="Google pretraga">
              <Search className="size-3.5" />
            </a>
            <a href={`https://www.google.com/maps/search/${encodeURIComponent(searchQ)}`} target="_blank" rel="noopener noreferrer" className="inline-flex size-9 items-center justify-center rounded-md border border-input bg-background transition-colors hover:bg-accent" title="Google Maps" aria-label="Google Maps">
              <MapPin className="size-3.5" />
            </a>
          </div>
        </div>
      </div>

      {activeTab === "overview" ? (
        <div className="space-y-6 p-4 md:p-6">
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Kontakt</CardTitle>
                  <CardDescription>Sva polja se automatski čuvaju kad klikneš van</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 gap-x-3 gap-y-3 md:grid-cols-2">
                    <EditableField leadId={id} name="name" label="Naziv" value={lead.name} required />
                    <EditableField leadId={id} name="category" label="Kategorija" value={lead.category} />
                    <EditableField leadId={id} name="city" label="Grad" value={lead.city} required />
                    <EditableField leadId={id} name="address" label="Adresa" value={lead.address} />
                    <EditableField leadId={id} name="postalCode" label="Poštanski broj" value={lead.postalCode} />
                    <EditableField leadId={id} name="phoneRaw" label="Telefon" value={lead.phoneRaw} type="tel" placeholder="064/123-4567" />
                    <EditableField leadId={id} name="email" label="Email" value={lead.email} type="email" />
                    <EditableField leadId={id} name="websiteRaw" label="Website" value={lead.websiteRaw} type="url" placeholder="example.rs" />
                    <EditableField leadId={id} name="googleRating" label="Google ocena (1–5)" value={lead.googleRating} type="number" step="0.1" min="1" max="5" />
                    <EditableField leadId={id} name="reviewsCount" label="Broj recenzija" value={lead.reviewsCount} type="number" min="0" />
                    <EditableField leadId={id} name="source" label="Izvor" value={lead.source} placeholder="npr. manual, poznanstvo…" />
                  </div>
                </CardContent>
              </Card>

              {emailSends.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Email istorija ({emailSends.length})</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="divide-y divide-border">
                      {emailSends.map((e) => (
                        <div key={e.id} className="py-3">
                          <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium">{e.subject || "(bez subject-a)"}</div>
                              <div className="text-xs text-muted-foreground">
                                {e.status} · {e.replied && "✓ reply"} · {e.generatedByAi ? "AI" : "ručno"}
                              </div>
                            </div>
                            <div className="text-xs text-muted-foreground">{formatDate(e.queuedAt ?? e.sentAt ?? null)}</div>
                          </div>
                          {e.body && (
                            <details className="mt-2">
                              <summary className="cursor-pointer text-xs text-primary">Prikaži telo</summary>
                              <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs">{e.body}</pre>
                            </details>
                          )}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {screenshots.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Screenshots ({screenshots.length})</CardTitle>
                    <CardDescription>Klikni sliku da je otvoriš u punoj veličini</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    {screenshots.map((s) => (
                      <a key={s.id} href={`/api/screenshot/${lead.id}?v=${s.id}`} target="_blank" rel="noopener noreferrer" className="group block w-full overflow-hidden rounded-md border border-border bg-muted/40 transition hover:border-primary">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/screenshot/${lead.id}?v=${s.id}`} alt={`Screenshot ${lead.name}`} loading="lazy" className="block w-full transition group-hover:opacity-90" />
                      </a>
                    ))}
                  </CardContent>
                </Card>
              )}
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Komentari ({comments.length})</CardTitle>
                  <CardDescription>Interne beleške — ne idu u email</CardDescription>
                </CardHeader>
                <CardContent>
                  <form action={addLeadComment} className="mb-4 space-y-2">
                    <input type="hidden" name="id" value={id} />
                    <textarea
                      name="body"
                      required
                      rows={3}
                      placeholder="Npr. 'Razgovarali smo u sredu, zainteresovan za uslugu, treba poslati ponudu'"
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 focus-visible:border-primary"
                    />
                    <div className="flex justify-end">
                      <Button type="submit" size="sm">
                        + Dodaj komentar
                      </Button>
                    </div>
                  </form>
                  {comments.length === 0 ? (
                    <p className="py-3 text-center text-sm text-muted-foreground">Nema komentara. Dodaj prvi iznad.</p>
                  ) : (
                    <ul className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
                      {comments.map((c) => (
                        <li key={c.id} className="rounded-md bg-muted/40 p-3 text-sm">
                          <div className="whitespace-pre-wrap">{c.body}</div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {timeAgo(c.createdAt)} · {formatDate(c.createdAt)}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Detalji</CardTitle>
                </CardHeader>
                <CardContent className="space-y-1 text-xs text-muted-foreground">
                  <div>ID: {lead.id}</div>
                  <div>Kreiran: {formatDate(lead.createdAt)}</div>
                  <div>Ažuriran: {formatDate(lead.updatedAt)}</div>
                  {lead.sourceUrl && (
                    <div>
                      <a href={lead.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                        Izvor ↗
                      </a>
                    </div>
                  )}
                  {scrapes.length > 0 && (
                    <div className="pt-2">
                      <div className="font-medium text-foreground">Scrape runovi</div>
                      {scrapes.map((s) => (
                        <div key={s.id} className="mt-1 rounded-md bg-muted/40 p-2">
                          <div className="font-medium">{s.status}</div>
                          <div className="text-xs">
                            {s.pagesScraped}/{s.totalPagesDiscovered} strana · {formatDate(s.startedAt)}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-6 p-4 md:p-6">
          {!auditReport ? (
            <Card>
              <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                <p className="font-medium">Nema audita za ovog leada</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  {lead.websiteNormalized
                    ? "Pokreni site audit dugmetom u traci iznad (audit traje 30–90 sekundi)."
                    : "Lead nema website — audit nije moguć."}
                </p>
              </CardContent>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-base">Site audit — {auditReport.domain ?? lead.websiteNormalized}</CardTitle>
                      <CardDescription>{formatDate(auditReport.createdAt)} · {Math.round(auditReport.durationMs / 1000)}s</CardDescription>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className={cn("inline-flex h-12 min-w-[3.5rem] items-center justify-center rounded-xl px-3 text-2xl font-bold tabular-nums", rankBadgeCls(auditReport.overallRank))}>
                        {auditReport.overallRank}
                      </span>
                      <div>
                        <div className="text-sm font-semibold">{auditReport.verdictLabel ?? auditReport.verdict}</div>
                        <div className="text-xs text-muted-foreground">od 100</div>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                {auditReport.pitchAdvice && (
                  <CardContent>
                    <div className="rounded-lg bg-primary-soft p-4 text-sm text-accent-foreground">{auditReport.pitchAdvice}</div>
                  </CardContent>
                )}
              </Card>

              {auditMetrics.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Po kategorijama</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {auditMetrics.map((m) => (
                      <div key={m.id}>
                        <div className="mb-1 flex items-center justify-between text-sm">
                          <span className="font-medium capitalize">{m.category.replace(/_/g, " ")}</span>
                          <span className="tabular-nums text-muted-foreground">
                            {m.score}/100 · težina {Math.round(m.weight * 100)}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-muted">
                          <div className={cn("h-full rounded-full", m.score >= 71 ? "bg-success" : m.score >= 56 ? "bg-warning" : "bg-destructive")} style={{ width: `${m.score}%` }} />
                        </div>
                        {(() => {
                          const issues = JSON.parse(m.issuesJson ?? "[]") as string[];
                          return issues.length > 0 ? (
                            <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-xs text-muted-foreground">
                              {issues.slice(0, 3).map((iss, i) => (
                                <li key={i}>{iss}</li>
                              ))}
                            </ul>
                          ) : null;
                        })()}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}

              {auditReport.top_issues.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Najvažniji problemi</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-2">
                      {auditReport.top_issues.map((iss, i) => (
                        <li key={i} className="flex items-start gap-2 rounded-md bg-destructive-soft px-3 py-2 text-sm text-destructive">
                          <TriangleAlert className="mt-0.5 size-4 shrink-0" />
                          {iss}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {auditHistory.length > 1 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Istorija audita</CardTitle>
                    <CardDescription>Poslednjih {auditHistory.length}</CardDescription>
                  </CardHeader>
                  <CardContent className="divide-y divide-border">
                    {auditHistory.map((h) => (
                      <div key={h.id} className="flex items-center justify-between py-2.5 text-sm">
                        <span className="text-muted-foreground">{formatDate(h.createdAt)}</span>
                        <span className={cn("inline-flex h-6 min-w-[2.5rem] items-center justify-center rounded-full px-2 text-xs font-semibold tabular-nums", rankBadgeCls(h.overallRank))}>
                          {h.overallRank}
                        </span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
