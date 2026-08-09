import Link from "next/link";
import { asc, desc, sql } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import {
  parseFilters,
  buildWhere,
  parseSort,
  buildOrderBy,
  COLUMNS,
  sortPriority,
  toggleSort,
  encodeSort,
} from "@/core/leads-query";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/empty-state";
import { formatNumber, formatPhone, cn } from "@/core/utils";
import { createLead } from "./actions";
import { ArrowUp, ArrowDown, ChevronLeft, ChevronRight, Search, Camera, Plus } from "lucide-react";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function first(v: string | string[] | undefined): string {
  return Array.isArray(v) ? (v[0] ?? "") : (v ?? "");
}

export default async function LeadsPage({ searchParams }: Props) {
  const spRaw = await searchParams;
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(spRaw)) if (v !== undefined) sp.set(k, first(v));

  const filters = parseFilters(sp);
  const sorts = parseSort(sp.get("sort"));
  const where = buildWhere(filters);
  const orderBy = buildOrderBy(sorts);

  const page = Math.max(1, Number(sp.get("page") ?? "1") || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const db = getDb();
  const total = db
    .select({ c: sql<number>`count(*)` })
    .from(schema.leads)
    .where(where)
    .get()?.c ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const rows = db
    .select({
      id: schema.leads.id,
      name: schema.leads.name,
      email: schema.leads.email,
      phone: schema.leads.phoneE164,
      website: schema.leads.websiteNormalized,
      city: schema.leads.city,
      category: schema.leads.category,
      googleRating: schema.leads.googleRating,
      reviewsCount: schema.leads.reviewsCount,
      doNotContact: schema.leads.doNotContact,
      statusName: schema.statuses.name,
      statusColor: schema.statuses.color,
      campaignName: schema.campaigns.name,
      m3: sql<number | null>`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
      hasScreenshot: sql<boolean>`EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id})`,
    })
    .from(schema.leads)
    .leftJoin(schema.statuses, sql`${schema.leads.statusId} = ${schema.statuses.id}`)
    .leftJoin(schema.campaigns, sql`${schema.leads.campaignId} = ${schema.campaigns.id}`)
    .where(where)
    .orderBy(...(orderBy.length ? orderBy : [desc(schema.leads.createdAt)]))
    .limit(PAGE_SIZE)
    .offset(offset)
    .all();

  const statuses = db.select().from(schema.statuses).all();
  const campaigns = db.select().from(schema.campaigns).all();

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(sp);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    return `/leads?${next.toString()}`;
  };

  const sortHref = (key: string) => {
    const meta = COLUMNS.find((c) => c.key === key);
    const next = toggleSort(sorts, key, false, meta?.defaultDir ?? "asc");
    return setParam("sort", encodeSort(next));
  };

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Leadovi</h1>
          <p className="text-sm text-muted-foreground">{formatNumber(total)} ukupno</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-4">
          <details className="group">
            <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium">
              <Plus className="size-4" /> Dodaj lead ručno
            </summary>
            <form action={createLead} className="mt-4 grid gap-3 md:grid-cols-4">
              <Input name="name" placeholder="Naziv *" required />
              <Input name="city" placeholder="Grad *" required />
              <Select name="campaignId" required defaultValue="">
                <option value="" disabled>
                  Kampanja *
                </option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
              <Input name="category" placeholder="Kategorija" />
              <Input name="email" type="email" placeholder="Email" />
              <Input name="phoneRaw" placeholder="Telefon" />
              <Input name="websiteRaw" placeholder="Website" />
              <Input name="address" placeholder="Adresa" />
              <div className="md:col-span-4">
                <Button type="submit" size="sm">
                  Sačuvaj lead
                </Button>
              </div>
            </form>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <form method="GET" action="/leads" className="grid gap-3 md:grid-cols-4">
            <div className="relative md:col-span-2">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="search" defaultValue={filters.search} placeholder="Pretraži naziv, email, grad…" className="pl-9" />
            </div>
            <Select name="statusId" defaultValue={filters.statusId}>
              <option value="">Svi statusi</option>
              <option value="null">Bez statusa</option>
              {statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            <Select name="campaignId" defaultValue={filters.campaignId}>
              <option value="">Sve kampanje</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
            <div className="flex gap-2 md:col-span-4">
              <Button type="submit" size="sm">
                Primeni filtere
              </Button>
              <Button type="button" variant="ghost" size="sm" asChild>
                <Link href="/leads">Očisti</Link>
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {rows.length === 0 ? (
            <div className="p-6">
              <EmptyState title="Nema rezultata" description="Pokušaj sa drugim filterima ili dodaj nove leadove." />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-secondary/40">
                    {COLUMNS.filter((c) => c.key !== "screenshot").map((col) => {
                      const prio = sortPriority(sorts, col.key);
                      const active = prio !== null;
                      const dir = active ? sorts[prio! - 1].dir : null;
                      return (
                        <th
                          key={col.key}
                          className={cn(
                            "h-10 whitespace-nowrap px-3 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground",
                            col.align === "center" && "text-center",
                            col.align === "right" && "text-right",
                          )}
                        >
                          {col.sortable ? (
                            <Link href={sortHref(col.key)} className="inline-flex items-center gap-1 hover:text-foreground">
                              {col.label}
                              {dir === "asc" && <ArrowUp className="size-3" />}
                              {dir === "desc" && <ArrowDown className="size-3" />}
                            </Link>
                          ) : (
                            col.label
                          )}
                        </th>
                      );
                    })}
                    <th className="w-12 px-3 text-center text-xs text-muted-foreground">📷</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-border transition-colors last:border-0 hover:bg-secondary/50">
                      <td className="min-w-[200px] px-3 py-2.5">
                        <Link href={`/leads/${r.id}`} className="font-medium hover:underline">
                          {r.name}
                        </Link>
                        {r.doNotContact && (
                          <Badge variant="destructive" className="ml-2">
                            DNC
                          </Badge>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5">
                        {r.statusName ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className="size-2 rounded-full" style={{ backgroundColor: r.statusColor ?? undefined }} />
                            {r.statusName}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.campaignName ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.category ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.city ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.email ?? "—"}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-muted-foreground">
                        {formatPhone(r.phone) || "—"}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 text-muted-foreground">{r.website ?? "—"}</td>
                      <td className="px-3 py-2.5 text-center">{r.googleRating ?? "—"}</td>
                      <td className="px-3 py-2.5 text-right">{formatNumber(r.reviewsCount)}</td>
                      <td className="px-3 py-2.5 text-center">{r.m3 ?? "—"}</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
                      <td className="px-3 py-2.5 text-center text-muted-foreground">—</td>
                      <td className="px-3 py-2.5 text-center">
                        {r.hasScreenshot ? <Camera className="mx-auto size-4 text-muted-foreground" /> : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {pageCount > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Strana {page} od {pageCount}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" disabled={page <= 1} asChild>
              <Link href={setParam("page", String(page - 1))}>
                <ChevronLeft /> Prethodna
              </Link>
            </Button>
            <Button variant="outline" size="sm" disabled={page >= pageCount} asChild>
              <Link href={setParam("page", String(page + 1))}>
                Sledeća <ChevronRight />
              </Link>
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
