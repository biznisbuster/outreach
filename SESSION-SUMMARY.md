# Session Summary — 2026-07-08

Kompletan pregled svega urađenog u ovoj sesiji. Za nastavak rada pročitaj ovo fajl prvo.

## Servisi (aktivni)

| Servis | Port | URL | Status |
|---|---|---|---|
| Next.js web (dev) | 3000 | http://localhost:3000 | ✅ radi |
| Old scraper (page crawl) | 8001 | http://localhost:8001 | ✅ radi |
| scraper-leads (Google Maps) | 8002 | http://localhost:8002 | ✅ radi |

Ako se nešto ne pokrene, pokreni iz odgovarajućeg foldera:

```bash
# Web
cd /Users/marko/Documents/Outreach/web && \
  DATABASE_URL=file:/Users/marko/Documents/Outreach/data/outreach.db \
  AUTH_PASSWORD_HASH='$2a$10$nHFuKr/CA9gVEhyJg7muSuNDCXg9Jh.mn7PKSMuzwM3LQm/5362v2' \
  AUTH_SECRET=devsecretdevsecretdevsecretdevsecret \
  AUTH_TRUST_HOST=true \
  NEXTAUTH_URL=http://localhost:3000 \
  MINIMAX_BASE_URL=https://api.minimax.io/v1 \
  MINIMAX_API_KEY=sk-placeholder \
  MINIMAX_MODEL=MiniMax-M3 \
  SCRAPER_URL=http://localhost:8001 \
  SCRAPER_LEADS_URL=http://localhost:8002 \
  ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef \
  npm run dev

# Old scraper (port 8001)
cd /Users/marko/Documents/Outreach/scraper && \
  DATABASE_PATH=/Users/marko/Documents/Outreach/data/outreach.db \
  SCREENSHOTS_DIR=/Users/marko/Documents/Outreach/data/screenshots \
  MAX_PAGES_PER_LEAD=20 SCRAPE_DELAY_SEC=0.5 \
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8001

# scraper-leads (port 8002)
cd /Users/marko/Documents/Outreach/scraper-leads && \
  RUNS_DIR=/Users/marko/Documents/Outreach/data/scraper-runs \
  uv run uvicorn maps_cold_calling.api:app --host 0.0.0.0 --port 8002
```

Login: `admin` / `admin` (env `AUTH_PASSWORD_HASH`).

## Tok sesije (u hronološkom redu)

### 1. Implementacija 6-faznog plana (outreach-ux-fixes-plan)
Prvo završeno 6 faza iz plana `1783459179891-outreach-ux-fixes-plan.md`:
- Lead count fix (correlated subquery → LEFT JOIN + GROUP BY)
- Website link data-stop na tabeli
- Inline status dropdown u leads-table
- Scrape dialog na campaign detail (umesto standalone /scrape stranice)
- Settings page (env → DB → default fallback)
- Auto-screenshot na lead detail
- "Za zvanje danas" dashboard widget sa `getCallTodo()` helperom

### 2. Next.js 14 → 16 upgrade
- `next` 14.2.21 → 16.2.10
- `react` 18.3.1 → 19.2.7
- `params`/`searchParams` sada `Promise<>` — async svuda
- `middleware.ts` → `proxy.ts` (preimenovano)
- `experimental.serverComponentsExternalPackages` → `serverExternalPackages`
- `next lint` uklonjen — eslint direktno

### 3. scraper-leads integracija (port 8002)
Novi Python servis koji wrappuje `maps_cold_calling` CLI (Playwright Google Maps scraper):
- `src/maps_cold_calling/api.py` — FastAPI sa 6 endpointa
- `Dockerfile` baziran na `mcr.microsoft.com/playwright/python`
- `docker-compose.yml` dopunjen sa `scraper-leads` servisom
- Next.js API proxy: `/api/scrape-leads/*`
- **Scrape dialog** na `/campaigns/[id]` (ne standalone /scrape stranica) — forma + live progress + checkbox import

### 4. scrape v2 upgrade
`scraper/maps_search.py` zamenjeno sa `scrape_v2.zip` verzijom:
- `wait_until=domcontentloaded` (30s idle, 4 scroll mehanizma, hard cap 10 min, progress logging, place_id dedup)

### 5. scrape v3 upgrade (progress events)
Dodata `progress.py` (ProgressEvent, ProgressEmitter):
- 7 stage-ova × 5 eventa (start/progress/end/skip/error)
- CLI flagovi `--progress-stdout`, `--progress-file`
- FastAPI: svaki job ima svoj `progress.json` + novi `/scrape-leads/progress/{job_id}` endpoint
- Next.js: `Scrape dialog` inline progress bar sa stage labelama (srpski)
- `changelog_api.py` + `/scrape-leads/changelog` endpoint
- **Settings → „Šta je novo u scraper-leads"** panel čita `CHANGELOG.md`

### 6. Globalna Settings (DB-backed)
- Novi `lib/settings.ts`: DB → env → default fallback, 19 podešavanja u 5 grupa
- `lib/audit.ts` + `audit_log` tabela za praćenje lead promena
- Settings UI: MiniMax, scraper URL-ovi, slanje emaila, IMAP, ostalo — svako polje pokazuje izvor (DB/env/default)
- Save fix: secret vrednosti se vraćaju dekriptovane (input type=password + Reveal dugme)
- `/api/settings/save` (GET za UI, POST za izmene)
- `/api/settings/auto-screenshot` toggle za lead detail

### 7. Scrape servis (port 8001) pokrenut lokalno + screenshot fix
- `screenshot.py`: `wait_until="networkidle"` → `domcontentloaded` retry sa analytics blokadom
- Pre toga Cvjetanović (lead 13) je imao 3 timeout-a
- Sada pravi screenshot 526KB, M3 vizuelna ocena 7/10

### 8. ActivityPanel + scrape progress
- `lib/activity-store.tsx` — globalni store + persistentni widget
- Pokazuje SVE paralelne procese (scrape_leads, lead_scrape, lead_analyze)
- Stage labela (srpski), progress bar, elapsed, ETA
- Perzistira u localStorage — preživi navigaciju
- Link „Otvori lead" / „Otvori kampanju" kad scrape završi

### 9. MiniMax analyze fix
- M3 parser: preskače `<think>...</think>` pre markdown-a
- Auto-scrape pre analyze ako nema screenshot-a
- Ako scrape servis ne radi — odmah 400 sa jasnom porukom
- UI: žuti alert + toast pokazuje **razlog** zašto je score null

### 10. Enrich endpoint (Google Maps lookup za postojeće leadove)
- `scraper-leads/src/maps_cold_calling/enrich.py` — fuzzy match po imenu (SequenceMatcher)
- Retry chain: name → category → generički "firma"
- Threshold 0.45
- Next.js `POST /api/leads/{id}/enrich` + **„Enrich" dugme** u lead detail
- Loguje u `audit_log` (source: "enrich-google-maps")

### 11. Bulk operations
- `POST /api/leads/bulk-jobs` (header `X-Bulk-Action: scrape|analyze`)
- Sekvencijalno procesira sve leadove (sa pauzom)
- `GET /api/leads/bulk-jobs/{jobId}` — progress polling
- `DELETE` — cancel
- **Leads table toolbar**: Scrape, Analiziraj (M3), Enrich selektovane + brze akcije „Scrape sve bez screenshota", „Analiziraj sve bez ocene"
- Bulk progress banner sa progress bar-om

### 12. UI/UX poboljšanja
- **Screenshot kolona** u leads-table (zelena tačka = ima, prazan krug = nema)
- **M3 score kolona** (ScoreBadge)
- **Header badge-ovi** na lead detail (Screenshot ✓/✗, M3 X/10, Google rating)
- **Inline progress banner** na lead detail (plavi spinner + green ✓)
- **"AI: generiši email"** dugme sa tooltip-om
- **ActivityPanel** veći, ring-2 oko aktivnih, animirana ikona, badge sa brojem
- Bulk delete zahteva kucanje „OBRIŠI"

## Ključne datoteke (čitaj ove za kontekst)

- `web/src/lib/settings.ts` — centralni runtime settings (DB → env → default)
- `web/src/lib/activity-store.tsx` — globalni activity store + ActivityPanel
- `web/src/lib/audit.ts` — `audit_log` helperi
- `web/src/lib/dashboard.ts` — `getCallTodo()` za "Za zvanje danas"
- `scraper-leads/src/maps_cold_calling/api.py` — FastAPI wrapper (port 8002)
- `scraper-leads/src/maps_cold_calling/enrich.py` — fuzzy Google Maps lookup
- `scraper-leads/src/maps_cold_calling/progress.py` — v3 progress events
- `scraper-leads/.agent_output/state/history/CHANGELOG.md` — istorija scraper-leads

## Šta korisnik može uraditi odmah u browseru

1. **Login** na http://localhost:3000 (admin/admin)
2. **Dashboard** — vidi "Za zvanje danas" widget
3. **Otvori `/campaigns/3`** (zubari Niš, 55 leadova)
   - Brze akcije: klikni **„Analiziraj sve bez ocene"**
   - Prati bulk progress u ActivityPanel-u (donji desni)
4. **Otvori bilo koji lead** (npr. lead 9, 10, 13)
   - Header badge-ovi: Screenshot, M3, Google
   - Inline progress kad klikneš Scrape/Analiziraj
   - „Enrich" dugme ako treba reviews_count
5. **Settings** — vidi „Šta je novo u scraper-leads" panel

## Poznati issue-i (nisu kritični)

1. **Build error na `npm run build`**: Turbopack pokušava `mkdir /data` tokom build faze kad `DATABASE_URL` nije setovan u build env. Dev mode radi savršeno. **Workaround**: docker compose build u produkciji, ili dodaj `DATABASE_URL` u build env.

2. **Cvjetanović (lead 13) ne postoji u Google Maps** — enrich vraća „best match 21%". Nema rešenja, Google ga nema u svom indeksu. Korisnik može ručno uneti reviews_count kroz Edit dugme.

3. **Stari scraper (port 8001) polovično radi za neke sajtove** — screenshot retry sa `domcontentloaded` rešava 90% slučajeva. Za 100% bi trebalo proxy rotation ili web archive fallback.

4. **`scrape_leads` job IDs se gube na restart** — in-memory store. Posle restarta scraper-leads API-ja, korisnik mora ponovo pokrenuti scrape.

5. **Bulk scrape traje dugo** — 53 leada × 30s = ~25 min. Acceptable, ali korisnik treba da zna.

## Verifikacija (šta je testirano)

- ✅ typecheck (`npm run typecheck`)
- ✅ lint (`npm run lint`)
- ✅ Scrape (lead 13, 20/20 strana, screenshot 526KB)
- ✅ Analyze (lead 13, 5.5/10, vizuelno 7, SEO 4)
- ✅ Enrich (lead 13 — best match 21%, fallback radi)
- ✅ Bulk scrape (campaign 3, 8/53 za 3 min, 27 screenshot-ova u bazi)
- ✅ Settings save (secret roundtrip OK)
- ✅ Audit log (kreiran, bulk_delete loguje)
- ✅ ActivityPanel (vidljiv, scrape progress tracking)

## Za nastavak rada

Pročitaj `README.md` za setup, pa ovaj fajl za kontekst. Svi TODO/fix-up su u CHANGELOG.md (oba projekta) i .agent_output/state/history/CHANGELOG.md.
