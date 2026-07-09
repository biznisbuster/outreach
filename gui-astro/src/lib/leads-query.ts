/**
 * Leads query — centralna logika za filter, sort i kolone.
 *
 * Koristi ga i API endpoint (`/api/leads`) i UI (`/leads/index.astro`) —
 * isti COLUMNS, isti parse/encode za sort, isti WHERE pravila.
 *
 * URL parametri za filter: vidi LEAD_FILTER_SCHEMA dole.
 * URL parametar za sort: `sort=col1:dir1,col2:dir2,...` (comma-separated, prioritet po redu).
 */
import { and, eq, isNull, sql, asc, desc, gte, lte, type SQL } from "drizzle-orm";
import { schema } from "./db";

// ─── Filter schema (URL parametri) ─────────────────────────────────────

export const LEAD_FILTERS = [
  "search",
  "statusId",
  "campaignId",
  "city",
  "hasEmail",
  "noWebsite",
  "hasPhone",
  "hasScreenshot",
  "dnc",
  "hasAnalysis",
  "minScore",
  "maxScore",
  "minReviews",
  "maxReviews",
  "minRating",
  "maxRating",
  "source",
  "importedFrom",
  "importedTo",
  "lastEmailStatus",
  "category",
] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];

export const EMAIL_STATUSES = ["draft", "queued", "sent", "failed", "bounced"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

const SOURCES = ["manual", "google_maps", "import"] as const;

// ─── Sort ──────────────────────────────────────────────────────────────

/**
 * Format: "name:asc,city:desc,sentAt:desc"
 * Parse: [{ key: "name", dir: "asc" }, ...]
 */
export interface SortEntry {
  key: string;
  dir: "asc" | "desc";
}

export function parseSort(raw: string | null | undefined): SortEntry[] {
  if (!raw) return [{ key: "createdAt", dir: "desc" }]; // default
  const out: SortEntry[] = [];
  for (const part of raw.split(",")) {
    const [key, dir] = part.split(":");
    if (!key) continue;
    out.push({ key, dir: dir === "asc" ? "asc" : "desc" });
  }
  return out.length > 0 ? out : [{ key: "createdAt", dir: "desc" }];
}

export function encodeSort(entries: SortEntry[]): string {
  return entries.map((e) => `${e.key}:${e.dir}`).join(",");
}

/**
 * Klik na header:
 *  - shift=false → single sort (zameni sve sa [{key, dir}])
 *  - shift=true → multi sort (dodaj/ukloni/toggle dir u nizu)
 */
export function toggleSort(
  current: SortEntry[],
  key: string,
  shiftKey: boolean,
  defaultDir: "asc" | "desc" = "asc",
): SortEntry[] {
  if (!shiftKey) {
    const existing = current.find((e) => e.key === key);
    if (current.length === 1 && existing) {
      // Toggle dir na jedinom ključu
      return [{ key, dir: existing.dir === "asc" ? "desc" : "asc" }];
    }
    return [{ key, dir: defaultDir }];
  }
  // Shift+Klik → multi-sort
  const idx = current.findIndex((e) => e.key === key);
  if (idx >= 0) {
    const copy = [...current];
    copy[idx] = { key, dir: copy[idx].dir === "asc" ? "desc" : "asc" };
    return copy;
  }
  return [...current, { key, dir: defaultDir }];
}

/**
 * Prioritet (1-based) date kolone u trenutnom sortu. Vraća null ako nije sortirana.
 */
export function sortPriority(current: SortEntry[], key: string): number | null {
  const idx = current.findIndex((e) => e.key === key);
  return idx >= 0 ? idx + 1 : null;
}

// ─── WHERE builder ────────────────────────────────────────────────────

/**
 * Parsira URLSearchParams → typed filter objekat.
 */
export interface LeadFilterValues {
  search: string;
  statusId: string; // "" | "null" | number-as-string
  campaignId: string;
  city: string;
  hasEmail: boolean;
  noWebsite: boolean;
  hasPhone: boolean;
  hasScreenshot: boolean;
  dnc: "any" | boolean;
  hasAnalysis: boolean;
  minScore: number | null;
  maxScore: number | null;
  minReviews: number | null;
  maxReviews: number | null;
  minRating: number | null;
  maxRating: number | null;
  source: string;
  importedFrom: string; // ISO date
  importedTo: string;
  lastEmailStatus: "any" | EmailStatus;
  category: string;
}

export function parseFilters(sp: URLSearchParams): LeadFilterValues {
  const get = (k: string) => sp.get(k) ?? "";
  const num = (k: string) => {
    const v = sp.get(k);
    if (!v) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const bool = (k: string) => sp.get(k) === "1";
  return {
    search: get("search").trim(),
    statusId: get("statusId"),
    campaignId: get("campaignId"),
    city: get("city"),
    hasEmail: bool("hasEmail"),
    noWebsite: bool("noWebsite"),
    hasPhone: bool("hasPhone"),
    hasScreenshot: bool("hasScreenshot"),
    dnc: sp.get("dnc") === "1" ? true : sp.get("dnc") === "0" ? false : "any",
    hasAnalysis: bool("hasAnalysis"),
    minScore: num("minScore"),
    maxScore: num("maxScore"),
    minReviews: num("minReviews"),
    maxReviews: num("maxReviews"),
    minRating: num("minRating"),
    maxRating: num("maxRating"),
    source: get("source"),
    importedFrom: get("importedFrom"),
    importedTo: get("importedTo"),
    lastEmailStatus:
      sp.get("lastEmailStatus") && (EMAIL_STATUSES as readonly string[]).includes(sp.get("lastEmailStatus")!)
        ? (sp.get("lastEmailStatus") as EmailStatus)
        : "any",
    category: get("category"),
  };
}

/**
 * Iz filter objekta gradi Drizzle WHERE uslove.
 * Vraća undefined ako nema filtera.
 */
export function buildWhere(f: LeadFilterValues): SQL | undefined {
  const conds: SQL[] = [];

  if (f.search) {
    const s = `%${f.search}%`;
    conds.push(
      sql`(lower(${schema.leads.name}) LIKE lower(${s}) OR lower(coalesce(${schema.leads.email},'')) LIKE lower(${s}) OR lower(coalesce(${schema.leads.city},'')) LIKE lower(${s}) OR lower(coalesce(${schema.leads.websiteNormalized},'')) LIKE lower(${s}) OR lower(coalesce(${schema.leads.category},'')) LIKE lower(${s}))`,
    );
  }
  if (f.statusId === "null") conds.push(isNull(schema.leads.statusId));
  else if (f.statusId) conds.push(eq(schema.leads.statusId, Number(f.statusId)));

  if (f.campaignId) conds.push(eq(schema.leads.campaignId, Number(f.campaignId)));
  if (f.city) conds.push(eq(schema.leads.city, f.city));
  if (f.category) conds.push(eq(schema.leads.category, f.category));

  if (f.hasEmail) conds.push(sql`${schema.leads.email} IS NOT NULL AND ${schema.leads.email} != ''`);
  if (f.noWebsite) conds.push(isNull(schema.leads.websiteNormalized));
  if (f.hasPhone) conds.push(sql`${schema.leads.phoneE164} IS NOT NULL AND ${schema.leads.phoneE164} != ''`);
  if (f.hasScreenshot) {
    conds.push(sql`EXISTS (SELECT 1 FROM screenshots s WHERE s.lead_id = ${schema.leads.id})`);
  }
  if (f.hasAnalysis) {
    conds.push(sql`EXISTS (SELECT 1 FROM site_analysis sa WHERE sa.lead_id = ${schema.leads.id})`);
  }
  if (f.dnc === true) conds.push(eq(schema.leads.doNotContact, true));
  if (f.dnc === false) conds.push(eq(schema.leads.doNotContact, false));

  if (f.minScore !== null) {
    conds.push(
      sql`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1) >= ${f.minScore}`,
    );
  }
  if (f.maxScore !== null) {
    conds.push(
      sql`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1) <= ${f.maxScore}`,
    );
  }
  if (f.minReviews !== null) conds.push(sql`${schema.leads.reviewsCount} >= ${f.minReviews}`);
  if (f.maxReviews !== null) conds.push(sql`${schema.leads.reviewsCount} <= ${f.maxReviews}`);
  if (f.minRating !== null) conds.push(sql`${schema.leads.googleRating} >= ${f.minRating}`);
  if (f.maxRating !== null) conds.push(sql`${schema.leads.googleRating} <= ${f.maxRating}`);

  if (f.source) conds.push(eq(schema.leads.source, f.source));
  if (f.importedFrom) {
    const ms = Date.parse(f.importedFrom);
    if (Number.isFinite(ms)) conds.push(gte(schema.leads.importedAt, new Date(ms)));
  }
  if (f.importedTo) {
    const ms = Date.parse(f.importedTo);
    if (Number.isFinite(ms)) conds.push(lte(schema.leads.importedAt, new Date(ms)));
  }

  if (f.lastEmailStatus !== "any") {
    conds.push(
      sql`(SELECT status FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1) = ${f.lastEmailStatus}`,
    );
  }

  return conds.length ? and(...conds) : undefined;
}

// ─── ORDER BY builder ────────────────────────────────────────────────

/**
 * Mapira "key" iz URL → Drizzle kolonu ili SQL izraz za sortiranje.
 * Za M3 koristimo subquery (isti kao u WHERE) da sort radi i kad lead ima više site_analysis redova.
 */
const SORT_COLS: Record<string, SQL | typeof schema.leads[keyof typeof schema.leads]> = {
  name: schema.leads.name,
  status: schema.leads.statusId,
  campaign: schema.leads.campaignId,
  city: schema.leads.city,
  category: schema.leads.category,
  email: schema.leads.email,
  phone: schema.leads.phoneE164,
  website: schema.leads.websiteNormalized,
  source: schema.leads.source,
  importedAt: schema.leads.importedAt,
  createdAt: schema.leads.createdAt,
  updatedAt: schema.leads.updatedAt,
  doNotContact: schema.leads.doNotContact,
  googleRating: schema.leads.googleRating,
  reviewsCount: schema.leads.reviewsCount,
  // Subqueries — koriste isti izraz kao u WHERE filterima
  m3Overall: sql`(SELECT overall_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
  m3Seo: sql`(SELECT seo_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
  m3Visual: sql`(SELECT visual_score FROM site_analysis WHERE lead_id = ${schema.leads.id} ORDER BY analyzed_at DESC LIMIT 1)`,
  // email_sends nema created_at — koristimo sent_at/queued_at, sa id kao tie-breaker
  lastEmail: sql`(SELECT COALESCE(email_sends.sent_at, email_sends.queued_at) FROM email_sends WHERE lead_id = ${schema.leads.id} ORDER BY COALESCE(email_sends.sent_at, email_sends.queued_at) DESC, email_sends.id DESC LIMIT 1)`,
};

export function buildOrderBy(sorts: SortEntry[]): SQL[] {
  const out: SQL[] = [];
  for (const s of sorts) {
    const col = SORT_COLS[s.key];
    if (!col) continue;
    const dir = s.dir === "asc" ? asc : desc;
    out.push(dir(col as never) as SQL);
  }
  return out;
}

// ─── Helper: dozvoljeni izvori ─────────────────────────────────────────

export const SOURCES_LIST = SOURCES;

// ─── Col metadata (za UI) ─────────────────────────────────────────────

export interface ColMeta {
  key: string;
  label: string;
  sortable: boolean;
  align?: "left" | "center" | "right";
  width?: string;
  defaultDir?: "asc" | "desc";
  /** CSS klasa za ćeliju (escape korisniku) */
  cellClass?: string;
  /** Prikaz u header-u (može sadržati emoji/svg) */
  headerHtml?: string;
}

export const COLUMNS: ColMeta[] = [
  { key: "name", label: "Naziv", sortable: true, width: "min-w-[200px]" },
  { key: "status", label: "Status", sortable: true },
  { key: "campaign", label: "Kampanja", sortable: true },
  { key: "category", label: "Kategorija", sortable: true },
  { key: "city", label: "Grad", sortable: true },
  { key: "email", label: "Email", sortable: true },
  { key: "phone", label: "Telefon", sortable: true },
  { key: "website", label: "Web", sortable: true },
  { key: "googleRating", label: "Rating", sortable: true, align: "center", width: "w-20", defaultDir: "desc" },
  { key: "reviewsCount", label: "Recenzije", sortable: true, align: "right", width: "w-24", defaultDir: "desc" },
  { key: "m3Overall", label: "M3", sortable: true, align: "center", width: "w-16", defaultDir: "desc" },
  { key: "m3Seo", label: "SEO", sortable: true, align: "center", width: "w-16", defaultDir: "desc" },
  { key: "lastEmail", label: "Posl. email", sortable: true, align: "center", width: "w-28", defaultDir: "desc" },
  { key: "importedAt", label: "Import", sortable: true, align: "center", width: "w-24", defaultDir: "desc" },
  { key: "doNotContact", label: "DNC", sortable: true, align: "center", width: "w-16" },
  { key: "source", label: "Izvor", sortable: true, width: "w-24" },
  { key: "screenshot", label: "📷", sortable: false, align: "center", width: "w-12", headerHtml: "📷" },
];