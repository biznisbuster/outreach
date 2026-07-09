# redesign whole ui/ux not changing functionaility astro-gui

_Generated: 2026-07-08T22:01:08.429Z_
_Last updated: 2026-07-09T22:33:04.495Z_

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



# Mobile responsive za `gui-astro/` — bez diranja desktop-a

_Generated: 2026-07-10_
_Last updated: 2026-07-10_

## Cilj

Aplikacija mora da radi udobno na telefonu (~360-414px širine), **bez ikakve promene** desktop izgleda (≥768px) i funkcionalnosti (URL parami, form akcije, inline JS, API rutе).

## Odluke (zaključane)

| Stvar | Odluka |
|---|---|
| Sidebar na mobilnom | **Hamburger + off-canvas drawer** sa overlay-om (iste linkove) |
| Tabele | **Hibrid**: postojeći horizontal-scroll na tableti/desktopu, **card stack** na telefonu (<640px) |
| Breakpoint sistem | Tailwind v4 default: `sm: 640px`, `md: 768px`, `lg: 1024px`. **Mobile-first**: default = mobilni, `md:` = tablet/desktop. |
| Scope (1. prolaz) | Kritične: `/leads`, `/leads/[id]`, `/` (dashboard) |
| Scope (2. prolaz) | `/queue`, `/campaigns`, `/campaigns/[id]`, `/inbox`, `/senders`, `/settings`, `/statuses`, `/templates`, `/audit`, `/attachments` |

## Arhitektura

### Tokovi na mobilnom

```
┌──────────────────────────────────────┐
│ [☰]  Outreach          [🔍] [theme] │  ← MobileTopBar (samo < md)
├──────────────────────────────────────┤
│                                       │
│   <Page slot>                         │  ← AppLayout main
│                                       │
│                                       │
├──────────────────────────────────────┤
│   (Tab-bar? NE — ima 14 strana)      │
└──────────────────────────────────────┘

Drawer (overlay, slide-in s leva):
┌─────────────────────┐
│ Outreach        [✕]  │
│ ─────────────────── │
│ Sad                 │
│  📊 Dashboard       │
│ Outreach            │
│  👥 Kampanje        │
│  📋 Leadovi         │
│  ...                │
│ ─────────────────── │
│ [🌗 Tema]           │
│ [Odjavi se]         │
└─────────────────────┘
```

## Fajlovi

### Novi

| Putanja | Svrha |
|---|---|
| `src/components/MobileTopBar.astro` | Fix header (h-14) sa hamburger-om (levo), brend imenom (centar), search/theme (desno). Vidljiv samo `<md`. |
| `src/components/MobileSidebar.astro` | Off-canvas drawer verzija Sidebar-a (render-uje isti `sections` array). Isti linkovi, ista logika aktivnog linka. |
| `src/lib/breakpoint.ts` | Pomoćne JS funkcije: `isMobile()`, `useBreakpoint()` — koriste `matchMedia` sa passive listenerom. |
| `src/styles/mobile.css` | Mobile-specifične CSS varijable, touch target minimumi, safe area insets, hover-disable na touch. |

### Izmenjeni

| Putanja | Izmena |
|---|---|
| `src/layouts/AppLayout.astro` | Dodaje `<MobileTopBar />`, drawer state (`<MobileSidebar />`), body scroll lock kad je drawer otvoren. Viewport meta proširen sa `viewport-fit=cover` za notched telefone. |
| `src/components/Sidebar.astro` | Dodaje `hidden md:flex` da se sakrije na mobilnom. Logika i dalje radi; MobileSidebar importuje isti `sections`. |
| `src/components/Table.astro` | Novi prop `responsive` (default `true`). Kada `true`: outer wrapper ima `md:overflow-x-auto`, ali je mobile verzija sakrivena. **Ili**: dva slota — `default` (tabela) i `cards` (card stack), prikaz po breakpointu. |
| `src/components/AddLeadDialog.astro` | `md:max-w-lg md:rounded-lg md:m-auto` + `md:mt-16` — na mobilnom postaje full-screen (modal postaje fixed inset-0). |
| `src/components/ImportDialog.astro` | Isto kao AddLeadDialog. |
| `src/components/CommandPalette.astro` | Već je overlay modal — dodaje samo `inset-0 md:inset-x-0 md:top-20 md:max-w-2xl md:mx-auto`. |
| `src/components/PageHeader.astro` | (1) Title `text-xl` → `text-lg md:text-xl` (default size). (2) `flex-wrap` već ima — dodaje `w-full md:w-auto` na actions slot kontejner da se dugmad slome na svoj red. (3) Padding `px-6 py-4` → `px-4 py-3 md:px-6 md:py-4`. |
| `src/components/KpiCard.astro` | Nema promena (koristi se u gridu; grid se menja u stranicama). |
| `src/components/FilterBar.astro` | Container `flex-wrap gap-2` — već radi za mobilni, ali treba dodati `flex-col sm:flex-row` da na telefonu inputi idu vertikalno. |
| `src/components/FilterPanel.astro` | Grid `grid-cols-2 md:grid-cols-3 lg:grid-cols-4` za field grupe. Na telefonu 1 kolona. |
| `src/components/Avatar.astro` | Veličina: fiksna → `h-9 w-9 md:h-10 md:w-10` za touch-friendly. |
| `src/components/Button.astro` | Touch target: dodaje `min-h-[44px] sm:min-h-0` za primarne akcije u PageHeader (iako već ima `h-9`, na mobilnom treba biti barem 44px). |
| `src/pages/index.astro` | KPI grid: `grid-cols-2 md:grid-cols-4` (umesto `grid-cols-4`). "Za zvanje danas" i ostali blokovi: `p-4 md:p-6`. |
| `src/pages/leads/index.astro` | (1) FilterBar/FilterPanel: `flex-col sm:flex-row` za search row. (2) Tabela: dodaje `cards` slot sa mobile card renderom (videti ispod). (3) Pagination: brojevi stranica skraćeni na mobilnom. |
| `src/pages/leads/[id].astro` | (1) Outer grid: `grid-cols-1 lg:grid-cols-3` (umesto `lg:grid-cols-3` ako već postoji). (2) Srednja kolona ide ispod na mobilnom. (3) AuditPanel (tab): collapse u accordion na mobilnom. (4) Comments/contact grid: `grid-cols-1 md:grid-cols-2`. |
| `src/pages/leads/new.astro` | Form grid: `grid-cols-1 md:grid-cols-2` (umesto `md:grid-cols-2` ako već ima). |

## Ključni CSS (mobile.css)

```css
/* Touch-friendly tap targets */
@media (pointer: coarse) {
  button, a[role="button"], [role="button"], input[type="submit"] {
    min-height: 44px;
  }
}

/* Disable hover na touch (čuva :hover state čistim) */
@media (hover: none) {
  *:hover { background-color: inherit !important; }
  /* Specifični hover efekti se primenjuju samo (hover: hover) */
}

/* Safe area (notched phones) */
.safe-top    { padding-top:    env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.safe-x      { padding-left:   env(safe-area-inset-left);
               padding-right:  env(safe-area-inset-right); }

/* Card view <sm */
.card-view   { display: block; }
.md\:table-view { display: none; }
@media (min-width: 640px) {
  .card-view   { display: none; }
  .md\:table-view { display: block; }
}
```

## Hibridna tabela — `Table.astro` (novi API)

```astro
<Table responsive>
  <table class="hidden sm:table w-full text-sm">
    <thead>...</thead>
    <tbody>...</tbody>
  </table>

  <!-- Mobile card view: isti rows, drugačiji layout -->
  <div class="sm:hidden space-y-2">
    {rows.map(row => (
      <a href={...} class="block rounded-lg border border-border bg-card p-3">
        <div class="font-medium">{row.name}</div>
        <div class="text-xs text-muted-foreground">{row.city} · {row.email}</div>
        <div class="mt-2 flex gap-2">...</div>
      </a>
    ))}
  </div>
</Table>
```

Wrapper detektuje `responsive` flag i primenjuje `p-0 sm:p-0` (bez border na mobilnom jer card view ima svoj border).

## Mobile drawer state (AppLayout)

```astro
<!-- U <body> -->
<MobileTopBar />
<div class="flex h-screen overflow-hidden">
  <Sidebar class="hidden md:flex" />     <!-- Desktop sidebar, sakriven <md -->
  <Sidebar
    variant="drawer"
    id="mobile-sidebar-drawer"
    class="md:hidden fixed inset-y-0 left-0 z-50 -translate-x-full transition-transform"
    data-drawer-state="closed"
  />
  <main class="flex-1 overflow-y-auto md:overflow-y-auto">
    <slot />
  </main>
</div>

<!-- Backdrop -->
<div id="mobile-sidebar-backdrop"
     class="md:hidden fixed inset-0 z-40 bg-black/50 opacity-0 pointer-events-none transition-opacity"
     data-backdrop-state="closed"></div>

<script is:inline>
  // Toggle logika
  function openDrawer() {
    document.getElementById('mobile-sidebar-drawer').dataset.drawerState = 'open';
    document.getElementById('mobile-sidebar-drawer').classList.remove('-translate-x-full');
    document.getElementById('mobile-sidebar-backdrop').dataset.backdropState = 'open';
    document.getElementById('mobile-sidebar-backdrop').classList.remove('opacity-0', 'pointer-events-none');
    document.body.style.overflow = 'hidden';
  }
  function closeDrawer() {
    document.getElementById('mobile-sidebar-drawer').dataset.drawerState = 'closed';
    document.getElementById('mobile-sidebar-drawer').classList.add('-translate-x-full');
    document.getElementById('mobile-sidebar-backdrop').dataset.backdropState = 'closed';
    document.getElementById('mobile-sidebar-backdrop').classList.add('opacity-0', 'pointer-events-none');
    document.body.style.overflow = '';
  }
  // Hamburger toggle, backdrop click, ESC, route change
</script>
```

## Touch-friendly akcije u PageHeader

Akcije u headeru (npr. `[+ Dodaj]`, `[Sačuvaj]`) treba da budu lako tapljive:
- Default button size je `h-9` (36px) — ispod Apple guideline (44px).
- Rešenje: novi `Button` size `mobile-touch` koji je `h-11 sm:h-9` (44px na mobilnom, 36px na desktopu).
- Alternativno: PageHeader wrap dugmad u `min-h-[44px] sm:min-h-0` kontejner.

## Verifikacija

1. **Build**: `cd gui-astro && npm run build` — bez grešaka
2. **Typecheck**: `npm run typecheck`
3. **Manualno** (Chrome DevTools responsive mode):
   - **iPhone SE (375×667)**: Dashboard, Leads lista, Lead detail — sve čitljivo, nema horizontalnog overflow-a sem unutar tabela gde je to namerno
   - **iPad (768×1024)**: Videti kao desktop, sidebar vidljiv, nema drawer
   - **1280px**: Identičan postojećem izgledu (regression check)
4. **Touch test**: Otvoriti stvarni mobilni uređaj, testirati tap targets, drawer gesture, dropdown menije

## Van scope-a (za kasnije)

- **PWA / offline mode** — zasebna priča, manifest + service worker
- **Bottom navigation** — odbačeno kao primarno rešenje; može kasnije ako treba
- **Gesture-based drawer** (swipe to open/close) — koristimo dugme za sada, swipe je nice-to-have
- **Print styles** — već ne postoje, dodati ako treba
- **Landscape orientation lock** za telefone — ne radimo

## Rizici / edge cases

1. **Tables with 10+ columns** (audit, leads) — card view mora da ima smislen "preview" subset polja, ne sve. Odlučiti per-page koji podaci su ključni.
2. **Modali sa dugim formama** — fullscreen modal na mobilnom = korisnik mora da skroluje formu BEZ da vidi backdrop. Dodati sticky header/footer u modal sa "Otkaži" / "Sačuvaj" dugmadima.
3. **Filteri sa puno inputa** — na mobilnom, default stanje je sve vidljivo (bez "Više filtera" collapsible) jer je prostor ionako ograničen. Ili: collapse u accordion.
4. **Leads detail screenshot lightbox** — inline JS koristi `document.body.style.overflow = 'hidden'` — u kombinaciji sa drawer lock-om može biti sukob. Koristiti klasu `body.no-scroll` umesto inline style.
5. **Sticky elements** (table header, page header sticky) — na mobilnom, sticky page header može da pojede previše prostora. Držati `sticky` samo na desktopu (`sticky md:sticky`).
6. **iOS Safari address bar** — `h-screen` ne radi pouzdano; koristiti `h-[100dvh]` za `MobileTopBar` i drawer.
7. **Hover state na touch** — videti `mobile.css` rešenje.
