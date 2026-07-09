# redesign whole ui/ux not changing functionaility astro-gui

_Generated: 2026-07-08T22:01:08.429Z_
_Last updated: 2026-07-09T13:59:19.352Z_

## Context

Project: `/home/usrtmp/Projects/local/scrapers/gui`

## Clarifications

### 1. How big should this redesign be? This determines whether I touch every page or focus on a few.

**Answer:** 

### 2. Which visual direction do you want? This sets the brand feel (colors, typography, layout density).

**Answer:** 

### 3. After the redesign, does `web/` (Next.js) also need to be updated, or only `gui-astro/`?

**Answer:** 

### 4. Should the redesign add a dark mode (CSS variables only, no toggle required)?

**Answer:** 

### 5. Should I add small UX quality-of-life features that don't change data behavior (e.g. toast notifications instead of ?ok= redirects, kbd shortcuts, kanban view for leads)?

**Answer:** 

### 6. Is there anything specific you want to keep or avoid in the redesign? Anything you'd flag as off-limits?

**Answer:** 

### 7. How aggressive should the audit be regarding external API dependencies? Some signals (visitor counts, top pages, traffic) really need paid APIs (SimilarWeb). The free/cheap alternatives give partial info: Tranco list gives a popularity rank (no visitor counts), and Open PageRank gives a 0-10 authority score. Which way should I lean?

**Answer:** Free-only — use Tranco rank + Open PageRank + everything we can scrape from the site itself. Skip visitor counts entirely (mark as N/A in the report).

### 8. Should I add the audit as a separate step (POST /audit endpoint that runs AFTER scrape completes), or merge it INTO the existing POST /scrape flow so every scrape automatically produces an audit report?

**Answer:** Separate endpoint — keep POST /scrape as-is, add POST /audit/{lead_id} that consumes the latest scrape and produces an audit report. More flexible, can re-audit without re-scraping.

### 9. Storage — the existing schema has site_scrapes, site_pages (with seo_metrics_json blob), screenshots, and site_analysis (a 1-10 AI score). For the audit, I want to store: (a) the full per-category metrics, (b) the weighted 0-100 site rank, (c) the verdict label. Two options:

**Answer:** New tables — add site_audits (lead_id, scrape_id, overall_rank, verdict, created_at) and site_audit_metrics (audit_id, category, sub_scores_json, raw_data_json). Cleaner, allows history.

### 10. UI side — should I build an Astro page (`gui-astro/src/pages/audits/[id].astro`) that renders the audit as a dashboard (per-category score cards, traffic signals, top issues, verdict banner)? Or keep this iteration pure-API and only return JSON (you can wire up the UI later)?

**Answer:** API only — return the JSON report from /audit/{lead_id} and store it. You can wire up the UI yourself later.

### 11. The current lead page has no tabs — it's one long scroll with Contact, Email, Screenshots on the left and Actions, Comments, Details on the right. Where should the new "Audit" tab live, and how aggressive should the restructure be?

**Answer:** Two tabs only — Add minimal tab nav with two tabs: "Overview" (current content) + "Audit" (new audit data). Keeps everything else as-is.


## Research Notes

### 1. 2026-07-08T22:01:51.949Z

## Existing UI inventory (`gui-astro/`)

### Stack & design language
- **Astro v7** + Tailwind v4 (`@tailwindcss/vite`) + Inter font
- **shadcn-style tokens** in `src/styles/globals.css` — `--color-*` via `@theme inline { ... }` (e.g. `--color-primary`, `--color-card`, `--radius: 0.5rem`)
- Color: blue primary (221.2 83.2 53.3), slate neutrals, semantic ad-hoc (green-50, amber-50, red-50)
- Layout: 240px sidebar (`Sidebar.astro`) + `main bg-slate-50/50`
- Existing components in `src/components/`: `Button.astro` (5 variants × 4 sizes), `Card.astro`, `CardHeader/Title/Description/Content.astro`, `Sidebar.astro`, `StatusSelect.astro`, `ScrapePanel.astro`

### Pages (14 .astro pages)
- `login.astro` — center card with lock icon
- `index.astro` — Dashboard: 4 KPI cards, "Za zvanje danas" todo card, status distribution bars, alerts, quick actions
- `campaigns/index.astro` — Campaign grid cards (3-col)
- `campaigns/[id].astro` — Most polished page already: status dist, bulk actions, ScrapePanel, sortable/searchable leads table with initials avatars, source badges, rating hint
- `leads/index.astro` — Filter form + table + pagination
- `leads/[id].astro` — 3-col layout: status form, comments, contact grid, email history, sidebar with actions/screenshots/scrape runs; inline JS for site scrape progress + screenshot lightbox
- `leads/new.astro` — Manual lead form
- `import.astro` — File/text upload → preview (new/dup/invalid counters) → commit
- `senders.astro` — SMTP config: create form + table + inline test/delete
- `queue.astro` — Status counter grid, filter chips, table; POST "Pokreni tick"
- `inbox.astro` — Reply cards list; POST "Poll IMAP"
- `settings.astro` — Grouped DB-backed settings + test IMAP
- `statuses.astro` — Create form + list with delete; inline JS for create
- `templates.astro` — Create + edit forms (textarea per item)
- `audit.astro` — Simple table

### UI pain points observed
1. **Header pattern repeated**: every page does `<div class="border-b px-6 py-4"><h1>...<p class="text-sm text-muted-foreground">...</p></div>`. Sometimes slate-200/bg-white, sometimes default border — inconsistent. No `PageHeader.astro` component yet.
2. **Button.astro underused**: most pages use raw `<button class="inline-flex h-9 items-center rounded-md bg-primary ...">`. The component exists but isn't adopted.
3. **Inconsistent empty states**: emoji vs icon, varying padding/colors across pages.
4. **Repeated filter bar**: `/leads` and `/queue` both reinvent filter forms. `/campaigns/[id]` has a polished client-side search+filter+sort pattern not reused elsewhere.
5. **Repeated feedback banners**: `bg-green-50 px-3 py-2 text-sm text-green-700` and red/amber variants copy-pasted in every page that shows ?ok= / ?error=.
6. **Status badge inline style**: `style="background:${color}1a;color:${color}"` for status pills — repeated in dashboard, leads list, queue, lead detail, campaign detail.
7. **Form inputs**: identical `class="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"` pasted everywhere. No `<Field>` / `<Input>` components.
8. **Table styling**: each page rolls its own `<table class="w-full text-sm">` + `<thead class="border-b bg-muted/40 text-xs uppercase text-muted-foreground">` + `<tbody class="divide-y">` — no shared Table component.
9. **Sidebar icons** are inline SVG strings from icon-name map — fragile, no icon library abstraction.
10. **No dark mode** (globals.css doesn't define dark tokens; `.dark` lives only in `web/`).
11. **Spacing/sizing inconsistent**: `text-xl` vs `text-2xl` for h1, `mt-0.5 mb-1` micro-spacing varies by author.
12. **Destructive confirmation** uses ad-hoc `onsubmit="return confirm(...) || event.preventDefault()"` scattered across templates.

### Functionality (must NOT change)
- All POST handlers, form actions, API routes, query strings, URL params (e.g. `?campaignId=`, `?status=open`, `?op=delete`), search/filter/pagination state, button `type`/`formaction`/etc., inline `<script is:inline>` blocks for site-scrape progress and screenshot lightbox — everything that touches data/control flow.

### Best reference
- `campaigns/[id].astro` is the most polished — initials avatar, source badge meta, rating hint, sortable table, sticky header. Design language to propagate.

### 2. 2026-07-08T22:07:24.662Z

## User decisions (Phase 2 answers)

1. **Scope**: FULL redesign (deep) — every page, full component system, new layout variants
2. **Visual direction**: BOLD, but tasteful — kanban, animated micro-interactions, glassmorphism where appropriate (cold-outreach/professional context)
3. **web/ (Next.js)**: SKIP — only gui-astro/
4. **Dark mode**: YES — full dark mode with tokens (no toggle requirement, but make CSS variables for both)
5. **UX extras**: LEVEL 2 — toast system + inline AJAX for bulk actions + kanban view for /leads
6. **Off-limits**: NONE — free hand

## Plan structure

- Foundation: design tokens (light + dark) + Tailwind v4 @theme inline
- Library: ~12 components (PageHeader, Field, StatusBadge, EmptyState, Banner, FilterBar, Table, KpiCard, Toast, Icon, Avatar, RatingHint)
- Layout: Sidebar redesign (sectioned nav, glass, collapse), AppLayout polish, ⌘K palette
- Pages: refresh all 14 .astro pages keeping data flow + URLs intact
- New features: Toast system (replaces ?ok banners optionally), inline AJAX for bulk actions, kanban view of /leads, dark mode toggle (localStorage), View Transitions API
- Polish: skeletons, hover/focus micro-animations

Constraints to preserve:
- All form actions, opcodes (`op=create|delete|update|test|commit|test-imap`), URL params (`?status=open`, `?campaignId=`, `?page=`, etc.) keep meaning
- API routes unchanged
- Inline `<script is:inline>` blocks (site scrape progress, screenshot lightbox, status create) keep working
- No new heavy dependencies (avoid full lucide package — use existing icon strings pattern + extend)

### 3. 2026-07-09T13:12:54.044Z

Audit API endpoint decision: POST /audit/{lead_id} consumes latest site_scrapes row. Allows re-audit without re-scraping. Existing POST /scrape stays untouched. Decision captured from user 2026-07-09.

Free-only traffic: Tranco (free popularity CSV) + Open PageRank (API-key gated). Visitor counts marked N/A.

Schema: new tables site_audits + site_audit_metrics, added to gui-astro schema.ts. Belt-and-suspenders CREATE TABLE IF NOT EXISTS in index.ts raw.exec block.

Verdict thresholds: 0-30 critical (aggressive pitch), 31-55 below_avg (strong pitch), 56-70 average (worth pitching), 71-85 good (cautious), 86-100 excellent (skip). Matches user's mental model.

Scoring is pure Python — no LLM in the loop. Existing site_analysis (AI 1-10 from screenshot) stays untouched.



# Leads refaktor — napredan filter, sort, fiksna visina

## Odlike (potvrđene)

- **Nove kolone:** Reviews, Google Rating, M3 Overall, M3 SEO, Last Email (status/datum)
- **Sort:** Shift+click = multi-column sa prioritetom (1/2/3)
- **Filteri:** Osnovni inline + collapsible "Više filtera" panel

## Arhitektura

```
Browser                           Server
────────                          ──────
GET /leads?sort=name:asc,...     →  parseSort(sort)
                                  →  buildWhere(filters)   (Drizzle WHERE)
                                  →  buildOrderBy(sorts)   (Drizzle ORDER BY)
                                  →  LEFT JOIN subqueries za M3 + last email
                                  →  render tabela
```

## Fajlovi

### Novi

| Putanja | Svrha |
|---|---|
| `src/lib/leads-query.ts` | Centralna logika: `COLUMNS`, `parseSort()`, `encodeSort()`, `buildWhere()`, `buildOrderBy()`. Koristi ga i API i UI. |
| `src/components/SortHeader.astro` | `<th>` komponenta: klik = sort, Shift+Klik = multi-sort. Prikazuje ▲▼ + broj prioriteta. |
| `src/components/FilterPanel.astro` | Collapsible panel sa naprednim filterima (score range, reviews range, rating range, source, import datum, last email status). |

### Izmene

| Putanja | Izmena |
|---|---|
| `src/pages/leads/index.astro` | Potpuni refaktor: novi FilterBar + collapsible panel + nova tabela sa fiksnom visinom + sticky header + multi-sort handler |
| `src/pages/api/leads.ts` | Koristi `buildWhere` + `buildOrderBy` iz lib-a, dodaje subquery za M3 + last email |

## URL parametri

### Filter (svi postoje + novi)

| Parametar | Tip | Primer |
|---|---|---|
| `search` | string | `?search=zubar` |
| `statusId` | id / "null" | `?statusId=3` |
| `campaignId` | id | `?campaignId=5` |
| `city` | string | `?city=Niš` |
| `hasEmail` | 0/1 | `?hasEmail=1` |
| `noWebsite` | 0/1 | `?noWebsite=1` |
| `hasPhone` | 0/1 | `?hasPhone=1` |
| `hasScreenshot` | 0/1 | `?hasScreenshot=1` |
| `dnc` | 0/1 | `?dnc=0` |
| **`hasAnalysis`** | 0/1 | `?hasAnalysis=1` (ima M3 ocenu) |
| **`minScore`, `maxScore`** | number | `?minScore=7&maxScore=10` (M3 overall) |
| **`minReviews`, `maxReviews`** | number | `?minReviews=10&maxReviews=100` |
| **`minRating`, `maxRating`** | number | `?minRating=4&maxRating=5` |
| **`source`** | string | `?source=google_maps` |
| **`importedFrom`, `importedTo`** | ISO date | `?importedFrom=2026-01-01` |
| **`lastEmailStatus`** | enum | `?lastEmailStatus=sent` (draft/queued/sent/failed/bounced/none) |

### Sort

`?sort=col1:dir1,col2:dir2,col3:dir3`

- `col` = key iz `COLUMNS` definicije
- `dir` = `asc` ili `desc`
- Više kolona = multi-sort sa prioritetom (redosled u URL-u)

Primeri:
- `?sort=name:asc`
- `?sort=createdAt:desc,name:asc` (primarni: noviji prvo, sekundarni: ime A-Z)

## Kolone

Definisane u `COLUMNS` nizu (lib/leads-query.ts). Svaka ima:
- `key` — URL/DB identifikator
- `label` — header text
- `sortable` — boolean
- `align` — left/center/right
- `class` — tailwind klase za ćeliju
- `render` — (row) => HTML (za custom badge-ove, linkove itd.)

```ts
type Col = {
  key: string;
  label: string;
  sortable: boolean;
  align?: "left" | "center" | "right";
  width?: string;          // "w-32", "min-w-[100px]"
  defaultSortDir?: "asc" | "desc";
  render: (row: LeadRow) => string;  // sigurno-escaped HTML
  raw?: (row: LeadRow) => unknown;    // za sortiranje ako je render drugačiji
};

const COLUMNS: Col[] = [
  { key: "name", label: "Naziv", sortable: true, ... },
  { key: "status", label: "Status", sortable: true, render: (r) => statusBadge(r.statusName, r.statusColor) },
  { key: "campaign", label: "Kampanja", sortable: true, render: (r) => r.campaignName ?? "—" },
  { key: "city", label: "Grad", sortable: true, ... },
  { key: "email", label: "Email", sortable: true, ... },
  { key: "phone", label: "Telefon", sortable: true, ... },
  { key: "website", label: "Web", sortable: true, ... },
  // NOVE:
  { key: "googleRating", label: "Rating", sortable: true, align: "center", render: (r) => r.googleRating ? `${r.googleRating}/5` : "—" },
  { key: "reviewsCount", label: "Recenzije", sortable: true, align: "right", render: (r) => r.reviewsCount ?? "—" },
  { key: "m3Overall", label: "M3", sortable: true, align: "center", render: (r) => m3Badge(r.m3Overall) },
  { key: "m3Seo", label: "SEO", sortable: true, align: "center", render: (r) => scoreBadge(r.m3Seo) },
  { key: "lastEmail", label: "Posl. email", sortable: true, render: (r) => lastEmailCell(r.lastEmailStatus, r.lastEmailSentAt) },
  { key: "screenshot", label: "📷", sortable: false, align: "center", ... },
];
```

## Sort UX

- Klik na `<th>`: ako je već jedini primarni → toggle dir; inače postavi kao jedini primarni (asc).
- Shift+Klik: dodaj u multi-sort (ako već postoji → toggle dir, ako je poslednji sa toggle na "asc" → ukloni).
- Indikatori:
  - `▲` za asc, `▼` za desc, prazno za nesortiranu
  - Broj prioriteta (1, 2, 3) za multi-sort
- Primer: `Name ▼1  City ▲2  Rating  (prazno)`

## Filter panel UX

```
┌────────────────────────────────────────────────────────────────────┐
│ [search...] [Status v] [Kampanja v] [Grad v] [Filtriraj] [Reset]   │
│                                                       [Više filtera v]│  ← toggle
└────────────────────────────────────────────────────────────────────┘
   Kada otvoreno:
┌────────────────────────────────────────────────────────────────────┐
│ M3 ocena: [min] — [max]     Recenzije: [min] — [max]               │
│ Google: [min] — [max]       Izvor: [v]                             │
│ Import: [od] [do]           Poslednji email: [v]                   │
│ [x] Ima screenshot  [x] Ima M3 ocenu  [x] U DNC                   │
└────────────────────────────────────────────────────────────────────┘
```

State drži u URL parametrima. Submit dugme refrešuje sa svim parametrima.

## Fiksna visina tabele

```css
.leads-table-wrapper {
  max-height: calc(100vh - 380px);  /* fallback: 70vh na manjim ekranima */
  overflow-y: auto;
  overflow-x: auto;
}
.leads-table-wrapper thead th {
  position: sticky;
  top: 0;
  z-index: 10;
  background: hsl(var(--card));  /* da ne prosijava */
}
```

Sticky header zadržava vidljivost kolona dok korisnik skroluje vertikalno.

## M3 + last email subqueries

Dodati u SELECT:

```sql
(SELECT overall_score FROM site_analysis 
 WHERE lead_id = leads.id ORDER BY analyzed_at DESC LIMIT 1) AS m3_overall,

(SELECT seo_score FROM site_analysis 
 WHERE lead_id = leads.id ORDER BY analyzed_at DESC LIMIT 1) AS m3_seo,

(SELECT status FROM email_sends 
 WHERE lead_id = leads.id ORDER BY COALESCE(sent_at, queued_at, created_at) DESC LIMIT 1) AS last_email_status,

(SELECT COALESCE(sent_at, queued_at, created_at) FROM email_sends 
 WHERE lead_id = leads.id ORDER BY COALESCE(sent_at, queued_at, created_at) DESC LIMIT 1) AS last_email_at
```

Postojeći CASE za `has_screenshot` se zamenjuje LEFT JOIN sa `screenshots` + DISTINCT ili ostaje kao EXISTS subquery (radi OK).

## Verifikacija

- typecheck (`npm run typecheck`)
- build (`npm run build`)
- Ručno: otvoriti `/leads` u browser-u, testirati:
  - Svaki filter radi samostalno
  - Kombinacija filtera radi
  - Sort klik + shift+click
  - Multi-sort URL se čuva
  - Tabela ima sticky header i fiksnu visinu
  - Tabela skroluje unutar sebe, ne ceo page

## Nije u scope-u

- Inline editovanje (klik na ćeliju → input) — zaseban feature
- Export filterovanih rezultata (CSV) — već postoji bulk, može se dograditi
- Saved views / bookmark filter kombinacija
- Bulk akcije u novoj tabeli (već rade preko bulk endpointa)