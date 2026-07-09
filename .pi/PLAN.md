# redesign whole ui/ux not changing functionaility astro-gui

_Generated: 2026-07-08T22:01:08.429Z_
_Last updated: 2026-07-09T11:07:39.958Z_

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


# Settings refaktor — sidebar navigacija + DB-backed config proširenje

## Cilj

1. **UI refaktor** `/settings`: dodati unutrašnji sidebar za navigaciju između
   sekcija (kartica), svaka kartica sa opisom i grupisanim podešavanjima.
2. **Proširenje DB-backed podešavanja**: identifikovati SVE env/hardcoded
   vrednosti koje imaju smisla da budu u `settings` tabeli i prebaciti ih na
   `getSetting()` pozive.

## UI refaktor — `src/pages/settings.astro`

### Layout

```
┌────────────────────────────────────────────────────────────────────┐
│ Header: "Podešavanja"                                              │
│ Subhead: "DB-backed runtime konfiguracija · DB > env > default"    │
│ Banner (ok/error)                                                   │
├──────────────────┬─────────────────────────────────────────────────┤
│ Sticky sidebar   │ Main: kartice (jedna po grupi)                  │
│                  │                                                  │
│ › Slanje emaila  │ ┌──────────────────────────────────────────┐    │
│   Bounce guard   │ │ Slanje emaila                  [badge DB]│    │
│   Scheduler      │ │ Prozor + cap-ovi + delay + retry          │    │
│   Scraper servisi│ └──────────────────────────────────────────┘    │
│   IMAP           │ ┌──────────────────────────────────────────┐    │
│   Dashboard      │ │ Bounce guard                              │    │
│   Unsubscribe    │ └──────────────────────────────────────────┘    │
│                  │ …                                                 │
│                  │                                                  │
│ [Sačuvaj sve]    │ (submit ide na dnu, van sidebara)               │
└──────────────────┴─────────────────────────────────────────────────┘
```

### Navigacija

- **Anchor linkovi** (`#email-sending`, `#bounce-guard`, itd.) — najjednostavniji.
- `location.hash` + `hashchange` event → aktivna stavka u sidebar-u.
- `IntersectionObserver` (opciono) → aktivna stavka prati scroll.
- Kartice imaju `id=` (slug) anchor target.
- Sidebar je `sticky top-0` unutar main flex kontejnera.
- Na mobilnom: sidebar se pretvara u `select` dropdown iznad kartica
  (proveriti `use client`/`is:inline` skripte).

### Opisi

Svaka kartica (grupa) ima:
- `title` (već ima u catalogu, samo rename `group` → display)
- `description` (šta ova grupa kontroliše, zašto je bitno)
- Svaki setting unutar ima:
  - `label` (već ima)
  - `description` (šta radi, default, kada se primenjuje)
  - `placeholder` (za prazne)
  - `envHint` (već ima, fallback)
  - vizuelni chip: `db` (plavi), `env` (žuti), `default` (sivi)
  - `Reset` dugme za pojedinačni setting (poziva `clearSetting`)
  - za `password` tip: reveal/hide toggle + `Reveal` chip ako ima vrednost

### Nove grupe (7 ukupno)

1. **Slanje emaila** — prozor slanja, default cap-ovi, default delay za nove sendere
2. **Bounce guard** — prag, prozor, sample size (zasebna grupa jer je kritično)
3. **Scheduler** — enabled, tick ms, batch size
4. **Scraper servisi** — URL-ovi, max_pages, auto_screenshot
5. **IMAP (reply tracking)** — host, port, user, password, folder, interval, secure
6. **Dashboard "Za zvanje danas"** — followup prozor, no-contact prozor, limit
7. **Unsubscribe** — base URL

## Proširenje DB podešavanja

### Nove stavke (dodaju se u `SETTINGS_CATALOG`)

| Ključ | Default | Grupa | Zamenjuje |
|---|---|---|---|
| `scheduler_enabled` | `1` | Scheduler | env `SCHEDULER_ENABLED` (instrumentation.ts) |
| `scheduler_tick_ms` | `60000` | Scheduler | env `SCHEDULER_TICK_MS` (scheduler.ts) |
| `scheduler_batch_size` | `20` | Scheduler | hardcoded `.limit(20)` u scheduler.ts |
| `bounce_threshold_pct` | `5` | Bounce guard | hardcoded `BOUNCE_THRESHOLD = 0.05` u scheduler.ts |
| `bounce_window_days` | `7` | Bounce guard | hardcoded `- 7 * 24 * 3600 * 1000` u throttler.ts |
| `bounce_sample_size` | `50` | Bounce guard | hardcoded `.limit(50)` u throttler.ts |
| `default_min_delay_sec` | `30` | Slanje emaila | hardcoded `30` u schema.ts + senders API + senders.astro |
| `default_max_delay_sec` | `120` | Slanje emaila | hardcoded `120` u schema.ts + senders API + senders.astro |
| `scraper_max_pages` | `20` | Scraper servisi | hardcoded `max_pages: 20` u scraping/client.ts |
| `imap_secure` | `1` | IMAP | hardcoded `secure: true` u imap.ts + test-imap API |
| `dashboard_followup_window_days` | `7` | Dashboard | hardcoded `cutoff7dMs` u dashboard.ts |
| `dashboard_followup_min_age_days` | `3` | Dashboard | hardcoded `cutoff3dMs` u dashboard.ts |
| `dashboard_no_contact_days` | `5` | Dashboard | hardcoded `cutoff5dMs` u dashboard.ts |
| `dashboard_call_todo_limit` | `20` | Dashboard | hardcoded `limit = 20` u dashboard.ts default arg |

### Izmene u `src/lib/settings.ts`

- Dodati 14 novih `SettingDef` unosa u `SETTINGS_CATALOG`.
- Svaki sa punim opisom (description ≥ 1 rečenica + zašto je bitno).
- Koriste `envHint` za postojeće env varijable (radi fallback).
- Nove grupe uvedene u katalog (redosled: Slanje → Bounce → Scheduler → Scraper → IMAP → Dashboard → Unsubscribe).

### Izmene u kodu koji ČITA podešavanja

| Fajl | Izmena |
|---|---|
| `src/lib/workers/scheduler.ts` | `process.env.SCHEDULER_TICK_MS` → `getSettingInt("scheduler_tick_ms")`. `BOUNCE_THRESHOLD` → `getSettingInt("bounce_threshold_pct") / 100`. `.limit(20)` → `getSettingInt("scheduler_batch_size")`. |
| `src/instrumentation.ts` | `process.env.SCHEDULER_ENABLED === "1"` → `getSetting("scheduler_enabled") === "1"` (sa dynamic import). |
| `src/lib/email/throttler.ts` | `recentBounceRate()`: hardcoded 7d/50 → `getSettingInt("bounce_window_days")` / `getSettingInt("bounce_sample_size")`. |
| `src/lib/scraping/client.ts` | `max_pages: 20` → `getSettingInt("scraper_max_pages")`. |
| `src/lib/email/imap.ts` | `secure: true` → `secure: getSettingBool("imap_secure")`. |
| `src/lib/dashboard.ts` | Hardcoded `cutoff7dMs`/`cutoff3dMs`/`cutoff5dMs` → `getSettingInt("dashboard_*")`. `limit = 20` default → `getSettingInt("dashboard_call_todo_limit")`. |
| `src/pages/api/senders.ts` | `process.env.DEFAULT_SENDER_DAILY_CAP/HOURLY_CAP` → već koriste `getSetting` za `.default()`, proveriti samo. `z.number().default(30/120)` → `getSettingInt("default_min/max_delay_sec")`. |
| `src/pages/senders.astro` | HTML form default `value="30"`/`"120"` → ne dirati (placeholder), ali server-side default bi trebalo da koristi settings. |
| `src/pages/api/settings/test-imap.ts` | `secure: true` → `getSettingBool("imap_secure")`. |
| `src/pages/settings.astro` | UI refaktor (cela stranica). |

## Opisi za postojeća podešavanja

Popuniti `description` polje za SVE settings (i stare i nove). Primer:

```ts
send_window_start: {
  key: "send_window_start",
  defaultValue: "09:00",
  group: "Slanje emaila",
  title: "Početak prozora slanja",          // NOVO (prikaz u kartici)
  label: "Početak (HH:MM)",                  // postojalo, zadržati kao input label
  description:
    "Od kog sata scheduler sme da šalje. " +
    "Format 24h (HH:MM). Podešava se po lokalnom vremenu sendera, " +
    "ne primaoca. Aktivno samo u dane definisane u 'Dani slanja'.",
  type: "text",
  envHint: "SEND_WINDOW_START",
},
```

## Validacija (pre commit-a)

- `npm run typecheck` u `gui-astro/`.
- `npm run build` (testira SSR — AGENTS.md poznati issue: Turbopack traži DATABASE_URL u build env, OK).
- Ručno: otvoriti `/settings`, kliknuti svaku sidebar stavku, sačuvati, restartovati server, proveriti da vrednost opstaje.
- Audit log: `settings.change` akcija se već loguje (proveriti u `lib/audit.ts`).

## Nije u scope-u (napomena za sledeći put)

- Bulk job config (batch size/interval) — može ići u Scheduler ako se ukaže potreba.
- Per-sender delay override (već u senders tabeli kao kolone).
- Audit log retencija (cleanup job) — poseban feature.
- `imap_secure` već postoji kao env var? Ne — nisam našao, samo hardcoded.
- Disclaimer za SMTP testiranje u UI (pored IMAP test dugmeta).