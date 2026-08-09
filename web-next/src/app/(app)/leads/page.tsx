import Link from "next/link";
import { asc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { parseFilters, parseSort, buildWhere, buildOrderBy, COLUMNS } from "@/core/leads-query";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/page-header";
import { SortHeaderCell } from "@/components/leads/sort-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn, formatNumber } from "@/core/utils";
import { Check, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

function fmtDate(ms: number | Date | null | undefined): string {
  if (!ms) return "—";
  const n = ms instanceof Date ? ms.getTime() : Number(ms);
  return new Date(n).toLocaleDateString("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function ScoreBadge({ s, max = 10 }: { s: number | null | undefined; max?: number }) {
  if (s == null) return <span className="text-muted-foreground/50">—</span>;
  const pct = s / max;
  const cls =
    pct >= 0.7
      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      : pct >= 0.4
        ? "bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300"
        : "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300";
  return (
    <span className={cn("inline-flex h-6 min-w-[2.25rem] items-center justify-center rounded-full px-1.5 text-xs font-semibold", cls)}>
      {s}
    </span>
  );
}

function StatusBadge({ name, color }: { name: string | null; color: string | null }) {
  if (!name) return <span className="text-muted-foreground/50">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 text-xs"
      style={{ background: `${color}1a`, color: color ?? undefined }}
    >
      {name}
    </span>
  );
}

const EMAIL_COLOR: Record<string, string> = {
  sent: "text-emerald-600 bg-emerald-500/15",
  failed: "text-red-600 bg-red-500/15",
  bounced: "text-red-600 bg-red-500/15",
  queued: "text-amber-600 bg-amber-500/15",
  sending: "text-amber-600 bg-amber-500/15",
  draft: "text-muted-foreground bg-muted",
};

function LastEmailCell({ status, at }: { status: string | null; at: number | null }) {
  if (!status) return <span className="text-muted-foreground/50">—</span>;
  return (
    <div className="flex flex-col items-center gap-0.5">
      <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium", EMAIL_COLOR[status] ?? "text-muted-foreground bg-muted")}>
        {status}
      </span>
      {at ? <span className="text-[10px] text-muted-foreground">{fmtDate(at)}</span> : null}
    </div>
  );
}

const QUICK_CHIPS: { key: string; label: string }[] = [
  { key: "hasEmail", label: "Ima email" },
  { key: "noWebsite", label: "Nema sajt" },
  { key: "hasPhone", label: "Ima telefon" },
  { key: "hasScreenshot", label: "Ima screenshot" },
  { key: "hasAnalysis", label: "Ima analizu" },
];

export default async function LeadsPage({ searchParams }: Props) {
  const spRaw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(spRaw)) if (v !== undefined) sp.set(k, first(v));

  const db = getDb();
  const filters = parseFilters(sp);
  const sortParam = sp.get("sort") ?? "";
  const sorts = parseSort(sortParam);
  const where = buildWhere(filters);
  const orderBy = buildOrderBy(sorts);

  const pageNum = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const pageSize = Math.min(Math.max(1, Number(sp.get("pageSize") ?? "100") || 100), 500);

  const baseSelect = db
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      category: schema.leads.category,
      phoneE164: schema.leads.phoneE164,
      email: schema.leads.email,
      websiteNormalized: schema.leads.websiteNormalized,
      address: schema.leads.address,
      city: schema.leads.city,
      googleRating: schema.leads.googleRating,
      reviewsCount: schema.leads.reviewsCount,
      source: schema.leads.source,
      doNotContact: schema.leads.doNotContact,
      importedAt: schema.leads.importedAt,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      campaignName: schema.campaigns.name,
      hasScreenshot: sql<number>`CASE WHEN EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id}) THEN 1 ELSE 0 END`,
      m3Overall: sql<number | null>`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      m3Seo: sql<number | null>`(SELECT seo_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      lastEmailStatus: sql<string | null>`(SELECT status FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1)`,
      lastEmailAt: sql<number | null>`(SELECT COALESCE(email_sends.sent_at, email_sends.queued_at) FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1)`,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, eq(schema.statuses.id, schema.leads.statusId))
    .leftJoin(schema.campaigns, eq(schema.campaigns.id, schema.leads.campaignId))
    .where(where);

  const items =
    orderBy.length > 0
      ? baseSelect.orderBy(...orderBy).limit(pageSize).offset((pageNum - 1) * pageSize).all()
      : baseSelect.orderBy(sql`${schema.leads.createdAt} DESC`).limit(pageSize).offset((pageNum - 1) * pageSize).all();

  const total = Number(db.select({ c: sql<number>`count(*)` }).from(schema.leads).where(where).all()[0]?.c ?? 0);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const statuses = db.select().from(schema.statuses).orderBy(asc(schema.statuses.sortOrder)).all();
  const campaigns = db
    .select({ id: schema.campaigns.id, name: schema.campaigns.name })
    .from(schema.campaigns)
    .orderBy(asc(schema.campaigns.name))
    .all();
  const cities = db
    .selectDistinct({ city: schema.leads.city })
    .from(schema.leads)
    .orderBy(asc(schema.leads.city))
    .all()
    .map((r) => r.city)
    .filter(Boolean) as string[];

  const buildUrl = (overrides: Record<string, string | number | null | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...Object.fromEntries(sp.entries()), page: String(pageNum), ...overrides })) {
      if (v !== null && v !== undefined && v !== "") params.set(k, String(v));
    }
    return `/leads?${params.toString()}`;
  };

  const toggleChip = (key: string) => {
    const cur = sp.get(key) === "1";
    return buildUrl({ [key]: cur ? null : "1", page: null });
  };

  const hasAnyFilter =
    filters.search || filters.statusId || filters.campaignId || filters.city ||
    filters.hasEmail || filters.noWebsite || filters.hasPhone || filters.hasScreenshot || filters.hasAnalysis ||
    filters.dnc !== "any" || filters.source || filters.category || filters.lastEmailStatus !== "any";

  const activeSorts = sortParam
    ? sortParam.split(",").map((p) => {
        const [k, d] = p.split(":");
        return { key: k, dir: (d === "asc" ? "asc" : "desc") as "asc" | "desc" };
      })
    : [];

  const colLabel = (key: string) => COLUMNS.find((c) => c.key === key)?.label ?? key;

  const removeSortUrl = (i: number) => {
    const next = activeSorts.filter((_, idx) => idx !== i);
    return buildUrl({ sort: next.length ? next.map((e) => `${e.key}:${e.dir}`).join(",") : null, page: null });
  };

  return (
    <div>
      <PageHeader
        title="Leadovi"
        subtitle={`${formatNumber(total)} ${total === 1 ? "lead" : "leadova"}${hasAnyFilter ? " · filtrirano" : ""}${totalPages > 1 ? ` · strana ${pageNum}/${totalPages}` : ""}`}
        actions={
          <Button size="sm" asChild>
            <Link href="/leads#novi">
              <Plus /> Dodaj lead
            </Link>
          </Button>
        }
      />

      <div className="space-y-4 p-4 md:p-6">
        <Card>
          <CardContent className="pt-4 md:pt-6">
            <form method="GET" action="/leads" className="space-y-4">
              <input type="hidden" name="sort" value={sortParam} />
              <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                <Input name="search" defaultValue={filters.search} placeholder="Pretraga…" className="h-11 sm:h-9 sm:w-64" />
                <Select name="statusId" defaultValue={filters.statusId} className="h-11 sm:h-9 sm:w-auto">
                  <option value="">Status: svi</option>
                  <option value="null">Bez statusa</option>
                  {statuses.map((s) => (
                    <option key={s.id} value={String(s.id)}>
                      {s.name}
                    </option>
                  ))}
                </Select>
                <Select name="campaignId" defaultValue={filters.campaignId} className="h-11 sm:h-9 sm:w-auto">
                  <option value="">Kampanja: sve</option>
                  {campaigns.map((c) => (
                    <option key={c.id} value={String(c.id)}>
                      {c.name}
                    </option>
                  ))}
                </Select>
                <Select name="city" defaultValue={filters.city} className="h-11 sm:h-9 sm:w-auto">
                  <option value="">Grad: svi</option>
                  {cities.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
                <div className="flex gap-2">
                  <Button type="submit" className="h-11 flex-1 sm:h-9 sm:flex-none">
                    Filtriraj
                  </Button>
                  {hasAnyFilter && (
                    <Button type="button" variant="outline" className="h-11 flex-1 sm:h-9 sm:flex-none" asChild>
                      <Link href="/leads">Reset</Link>
                    </Button>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                {QUICK_CHIPS.map((chip) => {
                  const active = sp.get(chip.key) === "1";
                  return (
                    <Link
                      key={chip.key}
                      href={toggleChip(chip.key)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                        active
                          ? "border-primary/40 bg-primary-soft text-primary"
                          : "border-border bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground",
                      )}
                    >
                      {active && <Check className="size-3" />}
                      {chip.label}
                    </Link>
                  );
                })}
              </div>
            </form>
          </CardContent>
        </Card>

        {activeSorts.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-sm">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sort:</span>
            {activeSorts.map((s, i) => (
              <span key={s.key} className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-0.5 text-xs font-medium shadow-sm">
                <span className="rounded bg-primary/15 px-1 text-[9px] font-bold text-primary">{i + 1}</span>
                {colLabel(s.key)} {s.dir === "asc" ? "▲" : "▼"}
                <Link href={removeSortUrl(i)} className="ml-1 text-muted-foreground hover:text-foreground" aria-label={`Ukloni sort ${colLabel(s.key)}`}>
                  ×
                </Link>
              </span>
            ))}
          </div>
        )}

        <Card className="overflow-hidden">
          {/* Desktop tabela */}
          <div className="hidden overflow-auto sm:block" style={{ maxHeight: "calc(100vh - 380px)" }}>
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 border-b border-border bg-card text-xs uppercase tracking-wider text-muted-foreground shadow-sm">
                <tr>
                  {COLUMNS.map((col) =>
                    col.sortable ? (
                      <SortHeaderCell
                        key={col.key}
                        colKey={col.key}
                        label={col.label}
                        align={col.align}
                        width={col.width}
                        defaultDir={col.defaultDir ?? "asc"}
                      />
                    ) : (
                      <th
                        key={col.key}
                        className={cn(
                          "px-3 py-2",
                          col.align === "right" ? "text-right" : col.align === "center" ? "text-center" : "text-left",
                          col.width,
                        )}
                      >
                        {col.label}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={COLUMNS.length} className="px-4 py-12 text-center text-muted-foreground">
                      Nema leadova za zadane filtere.
                    </td>
                  </tr>
                ) : (
                  items.map((r) => (
                    <tr key={r.id} className="hover:bg-accent/50">
                      <td className="px-3 py-2">
                        <div className="flex items-start gap-2">
                          <div className="min-w-0 flex-1">
                            <Link href={`/leads/${r.id}`} className="font-medium text-foreground hover:underline">
                              {r.name}
                            </Link>
                            {r.address && <div className="mt-0.5 truncate text-xs text-muted-foreground">{r.address}</div>}
                          </div>
                          {r.doNotContact && (
                            <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                              DNC
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge name={r.statusName} color={r.statusColor} />
                      </td>
                      <td className="px-3 py-2">{r.campaignName ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-3 py-2">{r.category ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-3 py-2">{r.city ?? <span className="text-muted-foreground/50">—</span>}</td>
                      <td className="px-3 py-2">
                        {r.email ? (
                          <a href={`mailto:${r.email}`} className="text-primary hover:underline">
                            {r.email}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.phoneE164 ? (
                          <a href={`tel:${r.phoneE164}`} className="text-primary hover:underline">
                            {r.phoneE164}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {r.websiteNormalized ? (
                          <a href={`https://${r.websiteNormalized}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                            {r.websiteNormalized}
                          </a>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.googleRating != null ? (
                          <span className="inline-flex items-center gap-0.5 text-sm font-medium">★ {r.googleRating.toFixed(1)}</span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {r.reviewsCount != null ? <span className="tabular-nums">{formatNumber(r.reviewsCount)}</span> : <span className="text-muted-foreground/50">—</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ScoreBadge s={r.m3Overall} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <ScoreBadge s={r.m3Seo} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <LastEmailCell status={r.lastEmailStatus} at={r.lastEmailAt} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.doNotContact ? (
                          <span className="inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            DNC
                          </span>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.hasScreenshot ? <Check className="mx-auto size-3.5 text-emerald-600" strokeWidth={2.5} /> : null}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* Mobile card view */}
          <div className="space-y-2 p-3 sm:hidden">
            {items.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">Nema leadova za zadane filtere.</div>
            ) : (
              items.map((r) => (
                <Link key={r.id} href={`/leads/${r.id}`} className="block rounded-lg border border-border bg-card p-3 transition-colors hover:border-primary/40 hover:bg-accent/30">
                  <div className="flex items-start gap-2">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-violet-500 text-[10px] font-bold text-primary-foreground">
                      {(r.name ?? "").split(/\s+/).map((w) => w[0] ?? "").filter(Boolean).slice(0, 2).join("").toUpperCase() || "?"}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-foreground">{r.name}</div>
                          {r.address && <div className="truncate text-[11px] text-muted-foreground">{r.address}</div>}
                        </div>
                        {r.doNotContact && (
                          <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-[9px] font-medium text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            DNC
                          </span>
                        )}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <StatusBadge name={r.statusName} color={r.statusColor} />
                        {r.m3Overall != null && <ScoreBadge s={r.m3Overall} />}
                        {r.googleRating != null && (
                          <span className="text-[10px] text-muted-foreground">
                            ★ {r.googleRating.toFixed(1)}
                            {r.reviewsCount != null ? ` (${r.reviewsCount})` : ""}
                          </span>
                        )}
                        {r.campaignName && <span className="text-[10px] text-muted-foreground">{r.campaignName}</span>}
                      </div>
                      <div className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
                        {r.city && <span>📍 {r.city}</span>}
                        {r.phoneE164 && <span>📞 {r.phoneE164}</span>}
                        {r.email && <span>✉</span>}
                        {r.websiteNormalized && <span>🌐</span>}
                        {r.hasScreenshot ? <span className="text-emerald-600">📷</span> : null}
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-border bg-muted/30 px-4 py-2 text-sm">
              <span className="text-xs text-muted-foreground">
                {formatNumber((pageNum - 1) * pageSize + 1)}–{formatNumber(Math.min(pageNum * pageSize, total))} od {formatNumber(total)}
              </span>
              <div className="flex items-center gap-2">
                {pageNum > 1 && (
                  <Link href={buildUrl({ page: pageNum - 1 })} className="inline-flex h-7 items-center rounded-md border border-border px-3 text-xs hover:bg-accent">
                    ←
                  </Link>
                )}
                <span className="text-xs">
                  Strana {pageNum} / {totalPages}
                </span>
                {pageNum < totalPages && (
                  <Link href={buildUrl({ page: pageNum + 1 })} className="inline-flex h-7 items-center rounded-md border border-border px-3 text-xs hover:bg-accent">
                    →
                  </Link>
                )}
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
