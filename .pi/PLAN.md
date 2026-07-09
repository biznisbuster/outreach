# redesign whole ui/ux not changing functionaility astro-gui

_Generated: 2026-07-08T22:01:08.429Z_
_Last updated: 2026-07-09T13:19:39.028Z_

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



# Email attachments — dizajn + implementacija

## Cilj

Dozvoliti slanje email-ova sa attachment fajlovima (PDF ponude, slike…).
Template ima default attachment; draft može da ga override-uje. Svi fajlovi
idu kroz globalnu biblioteku.

## Odluke (potvrđene)

| Pitanje | Odgovor |
|---|---|
| Nivo | Template default + draft override (draft zamenjuje template) |
| Max size | 10 MB |
| Dozvoljeni tipovi | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` |
| UI | Globalna biblioteka (`/attachments`) + inline u template/draft editoru |

## Arhitektura

```
[Browser]
  ├─ /attachments           → globalna biblioteka (upload/list/delete/preview)
  ├─ /templates/[edit]      → attach fajlove na template (default za sve draft-ove)
  └─ /queue/[edit draft]    → override attachment za pojedinačni draft

[Upload API]
  POST /api/attachments (multipart)
    → validacija (size, MIME)
    → SHA-256 izračun
    → ako postoji sa istim sha256 → vrati postojeći (dedup)
    → sačuvaj na ~/outreach-data/attachments/<sha256>.<ext>
    → INSERT u `attachments`
    → vrati { id, original_name, mime_type, size }

[Send flow]
  processQueue() za queued email:
    1. Pokušaj draft override:
       SELECT * FROM email_send_attachments WHERE email_send_id = ?
       Ako ima → koristi SAMO ove (skip template)
    2. Inače, ako email ima prompt_template_id:
       SELECT * FROM template_attachments WHERE template_id = ?
    3. Ako ništa → nema attachment-a

  sendEmail({ ..., attachments: [{filename, path}] })
    → nodemailer attachments: [{ filename, path }]
    → multipart MIME, primaoc vidi attachment u inboxu
```

## Fajlovi

### Novi API endpoint-i

| Putanja | Metod | Svrha |
|---|---|---|
| `src/pages/api/attachments/index.ts` | POST, GET | upload + list |
| `src/pages/api/attachments/[id].ts` | GET, DELETE | metadata + delete |
| `src/pages/api/attachments/[id]/file.ts` | GET | download/preview (binarno) |
| `src/pages/api/templates/[id]/attachments.ts` | POST, DELETE | veži/odveži na template |
| `src/pages/api/email/drafts/[id]/attachments.ts` | POST, DELETE | override na draft |

### Novi lib

| Putanja | Svrha |
|---|---|
| `src/lib/attachments.ts` | `validateUpload()`, `saveAttachment()`, `getAttachmentsForSend()`, `purgeUnused()` |

### Izmene

| Putanja | Izmena |
|---|---|
| `src/lib/db/schema.ts` | +3 tabele (attachments, template_attachments, email_send_attachments) |
| `src/lib/settings.ts` | +2 settings (attachment_max_size_mb, attachment_allowed_mime) u grupi "Email attachments" |
| `src/lib/email/sender.ts` | `SendInput.attachments?: {filename, path}[]`, prosleđuje nodemailer-u |
| `src/lib/workers/scheduler.ts` | Pre slanja, izračunaj `getAttachmentsForSend(emailSendId)` i prosledi |
| `src/components/Sidebar.astro` | Dodaj "Attachments" link (Setup sekcija) |
| `src/pages/templates.astro` | Prikaz i edit attachment-a u template formi |
| `src/pages/queue.astro` | Prikaz attachment-a po draft-u, override UI |
| `deploy/backup-outreach.sh` | +tar attachments dir u backup |
| `docker-compose.vps.yml` | (nema izmene — attachment-i idu kroz postojeći `~/outreach-data:/data` mount) |
| `README.md` | +sekcija "Email attachments" |

### Novi UI

- `src/pages/attachments.astro` — globalna biblioteka
  - Drag&drop zona za upload
  - Tabela: ime, MIME, veličina, datum, [preview] [delete]
  - Prazno stanje sa uputstvom
- `src/components/AttachmentPicker.astro` — modal za izbor iz biblioteke
- `src/components/AttachmentList.astro` — readonly lista sa remove dugmadima

## Validacija

```ts
const ALLOWED_MIME = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MAX_SIZE_DEFAULT = 10 * 1024 * 1024; // 10MB
// čita se iz settings `attachment_max_size_mb` i parsira `attachment_allowed_mime` (comma-list)
```

Upload validator:
- `file.size > MAX_SIZE` → 400 "Max 10MB"
- `!ALLOWED_MIME.includes(file.type)` → 400 "Tip nije dozvoljen"
- Prazan fajl → 400

## Storage

```
~/outreach-data/attachments/<sha256>.<ext>
```

- Van repo-a (kao `outreach.db`)
- Lako se bekapuje (tar u `backup-outreach.sh`)
- Deduplikacija po sha256 — isti fajl upload-ovan 2x ne duplira se
- Container path: `/data/attachments/<sha256>.<ext>` (kroz postojeći mount)

## API detalji

### POST /api/attachments (multipart)

Request: `FormData { file: File }`
Response 201: `{ id, original_name, mime_type, size, uploaded_at }`
Errors: 400 (validacija), 413 (prevelik), 415 (pogrešan tip)

### GET /api/attachments

Response: `[{ id, original_name, mime_type, size, uploaded_at, used_by_templates: number, used_by_drafts: number }]`

### DELETE /api/attachments/[id]

- Ako `used_by_templates + used_by_drafts > 0` → 409 "Koristi se u N template-a i M draft-ova"
- Inače: obriši fajl sa diska + DELETE row

### POST /api/templates/[id]/attachments

Body: `{ attachment_id: number }`
→ INSERT u template_attachments (ON CONFLICT IGNORE)

### POST /api/email/drafts/[id]/attachments

Body: `{ attachment_id: number }`
→ Briše SVE prethodne email_send_attachments za taj draft (override znači zamenu)
→ INSERT novu

## Settings (nova grupa "Email attachments")

```yaml
- key: attachment_max_size_mb
  defaultValue: "10"
  type: number
  unit: MB
  description: Maksimalna veličina po attachment fajlu...

- key: attachment_allowed_mime
  defaultValue: "application/pdf,image/jpeg,image/png,image/webp"
  type: text
  description: Dozvoljeni MIME tipovi (comma-separated)...
```

## UI flow

### Upload attachment
1. Odeš na `/attachments`
2. Drag-drop ili klik → file picker
3. Validacija uživo (size, MIME)
4. Upload → pojavi se u listi
5. Download dugme za preview

### Dodaj na template
1. Odeš na `/templates`
2. Edit template → vidiš "Attachments (0)" sekcija
3. Klik "Dodaj attachment" → modal sa listom iz biblioteke
4. Izaberi → pojavi se u listi sa remove dugmetom

### Override na draft
1. Odeš na `/queue`
2. Otvoriš draft → vidiš "Attachments: nasleđeno od template-a [x]" ILI "Custom: [...]"
3. Klik "Zameni" → modal sa listom → izaberi
4. Ili klik "Ukloni sve" da pošalješ bez attachment-a

## Send logika (scheduler)

```ts
// scheduler.ts, unutar processQueue()
const attachments = getAttachmentsForSend(es.id); // draft override ILI template ILI []
const sendRes = await sendEmail({
  // ... postojeća polja
  attachments,
});
```

`getAttachmentsForSend(emailSendId)`:
1. SELECT * FROM email_send_attachments JOIN attachments WHERE email_send_id = ?
2. Ako rows.length > 0 → vrati draft attachments (override)
3. Inače ako email_send ima prompt_template_id:
   SELECT * FROM template_attachments JOIN attachments WHERE template_id = ?
4. Vrati prazan niz

```ts
// lib/email/sender.ts — SendInput
export interface SendInput {
  // ... postojeća polja
  attachments?: { filename: string; path: string }[];
}

// u sendMail()
attachments: input.attachments?.map(a => ({
  filename: a.filename,
  path: a.path,
})),
```

## Bezbednost

- Upload validira MIME i size pre čuvanja
- MIME po content-type header-u (ne po ekstenziji — može se falsifikovati)
- File path NE dolazi od korisnika — uvek se generiše `<sha256>.<ext>` iz content-a
- `originalName` se čuva samo za prikaz u UI, ne koristi se za slanje
- Send logika koristi isključivo DB-čuvane path-ove

## Testiranje

- Upload PDF → pojavi se u `/attachments`
- Dodaj na template → vidi se u template edit formi
- Draft iz tog template-a → "nasleđeno" + broj attachment-a
- Override na draft → vidi se custom
- Pošalji test email → attachment stiže u inbox
- Bulk delete template → cascade briše template_attachments
- Obriši attachment koji se koristi → 409 error
- Backup skripta → tar attachments + restore

## Nije u scope-u (za sledeći put)

- Inline slike u telu emaila (CID attachments)
- Attachment-i iz URL-a (npr. logo sa CDN-a)
- Cloud storage (S3) za attachment preko 50MB
- Antivirus/MIME validacija (Content-Type po header-u je bazična)
- Auto-cleanup orphaned attachment-a (purgeUnused helper u lib, ali UI nije u v1)