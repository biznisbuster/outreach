# Outreach

> Solo B2B cold outreach platforma za Srbiju — Astro GUI, Python scraper servisi, AI hiper-personalizacija emailova, IMAP reply tracking. Single-user, single-server, SQLite, Docker-ready.

Owner-operated aplikacija za pronalaženje lokalnih biznisa (zubari, frizeri, automehaničari…), automatsko skrejpovanje njihovih sajtova, generisanje personalizovanih emailova preko AI-ja, i praćenje reply-ja — sve sa jednog mesta.

## Sadržaj

- [Arhitektura](#arhitektura)
- [Brzo pokretanje](#brzo-pokretanje)
- [Struktura projekta](#struktura-projekta)
- [Tech stack](#tech-stack)
- [Env varijable](#env-varijable)
- [Podešavanja (DB-backed)](#podešavanja-db-backed)
- [Scrape servisi](#scrape-servisi)
- [Slanje emaila](#slanje-emaila)
- [IMAP reply tracking](#imap-reply-tracking)
- [Baza podataka](#baza-podataka)
- [Backup](#backup)
- [VPS deployment](#vps-deployment)
- [Razvoj](#razvoj)

## Arhitektura

```
[Browser] → [Astro GUI :3000]
              ├─ SSR + REST API
              ├─ node-cron worker (scheduler tick + IMAP poll)
              ├─ Drizzle ORM → SQLite (data/outreach.db)
              ├─ DB-backed runtime settings (DB → env → default)
              ├─ HTTP → [Python FastAPI :8001 scraper]      (page-by-page crawl + screenshot)
              └─ HTTP → [Python FastAPI :8002 scraper-leads] (Google Maps + CSV + progress events)

[Astro scheduler]
  ├─ processQueue() — šalje queued emailove
  │   ├─ proverava bounce rate → pauzira sendere ako je > threshold
  │   ├─ proverava send window (HH:MM, tz, dani)
  │   ├─ bira sender round-robin (poštuje daily/hourly cap)
  │   └─ šalje preko nodemailer + SMTP
  └─ pollImap() — detektuje reply, stopira sekvence, lead → status "Odgovorio"

[Astro + scraper-leads] → MiniMax M3 (text + vision) za:
  ├─ vizuelnu ocenu screenshota (1-10)
  ├─ SEO sumar po stranicama
  └─ email personalizaciju (lead → draft)
```

**Jedan korisnik, jedan server.** Namerno nema multi-tenancy, auth je bcrypt + HMAC cookie.

## Brzo pokretanje

### Preduslovi

- Node.js 20+
- Python 3.11+ (samo za scrape servise)
- SQLite (sistemski, za CLI backup skripte)
- Docker (opciono, za produkciju/VPS)

### 1. Kloniraj i instaliraj

```bash
git clone https://github.com/djordjeveljkovic/outreach.git
cd outreach
cp .env.example .env
# uredi .env — vidi [Env varijable](#env-varijable)
```

### 2. Generiši secret-e

```bash
# AUTH_SECRET — 32 byte random hex za HMAC cookie
openssl rand -hex 32

# ENCRYPTION_KEY — 32 byte hex (64 karaktera) za AES-256-GCM SMTP šifri
openssl rand -hex 32

# AUTH_PASSWORD — tvoja login šifra (hešuje se u letu, ne treba ti bcrypt)
# proizvoljno, npr. outreach2025
```

Kopiraj sve tri u `.env`.

### 3. Lokalni dev (bez Docker-a)

```bash
# GUI
cd gui-astro
npm install
npm run db:migrate   # Drizzle migracije (kreira data/outreach.db)
npm run dev          # → http://localhost:3000

# Stari scraper (port 8001) — page-by-page crawl + screenshot
cd ../scraper
uv sync
DATABASE_PATH=../data/outreach.db \
  MAX_PAGES_PER_LEAD=20 \
  uv run uvicorn app.main:app --host 0.0.0.0 --port 8001

# scraper-leads (port 8002) — Google Maps + CSV + progress
cd ../scraper-leads
uv sync
RUNS_DIR=../data/scraper-runs \
  uv run python -m uvicorn maps_cold_calling.api:app --host 0.0.0.0 --port 8002
```

Login: šifra koju si stavio u `AUTH_PASSWORD`.

### 4. Docker compose (VPS / produkcija)

Jedan `docker-compose.vps.yml` pokreće 3 kontejnera (gui-astro + 2 scrapera). Reverse proxy (Caddy/Nginx) je sistemski na hostu.

Detaljan vodič: [`deploy/README.md`](./deploy/README.md).

```bash
# na VPS-u
git clone https://github.com/djordjeveljkovic/outreach.git ~/outreach && cd ~/outreach
cp .env.example .env  # uredi
./deploy/setup-vps.sh  # kreira ~/outreach-data + dodaje OUTREACH_DATA_DIR u .env
docker compose -f docker-compose.vps.yml --env-file .env up -d --build
```

## Struktura projekta

```
outreach/
├── gui-astro/              # Astro 7 SSR GUI + admin panel
│   ├── src/
│   │   ├── components/     # Card, Sidebar, ThemeToggle, SettingsRow, ScrapePanel, …
│   │   ├── layouts/        # AppLayout (sidebar + main)
│   │   ├── lib/
│   │   │   ├── db/         # Drizzle schema + connection
│   │   │   ├── email/      # sender, throttler, sequence, imap
│   │   │   ├── scraping/   # HTTP client ka Python servisu
│   │   │   ├── workers/    # scheduler tick + IMAP poll
│   │   │   ├── settings.ts # DB-backed runtime config (central)
│   │   │   ├── auth.ts     # bcrypt + single-user seed
│   │   │   ├── crypto.ts   # AES-256-GCM (SMTP šifre, IMAP password)
│   │   │   ├── audit.ts    # audit log helper
│   │   │   ├── dashboard.ts# "Za zvanje danas" widget
│   │   │   └── prompts.ts  # default prompt templates (DB seeded)
│   │   ├── pages/
│   │   │   ├── api/        # REST endpoints (campaigns, leads, scrape, settings, …)
│   │   │   ├── index.astro     # Dashboard
│   │   │   ├── campaigns/      # lista + detail + bulk
│   │   │   ├── leads/          # lista + detail + bulk + individual
│   │   │   ├── queue.astro     # email draft / queued / sent / failed / bounced
│   │   │   ├── inbox.astro     # reply tracking
│   │   │   ├── senders.astro   # SMTP senderi (per-row cap, delay, password)
│   │   │   ├── templates.astro # AI prompt templates
│   │   │   ├── statuses.astro  # pipeline statusi
│   │   │   ├── settings.astro  # ⭐ DB-backed config (sidebar + kartice)
│   │   │   ├── audit.astro     # audit log
│   │   │   └── login.astro
│   │   ├── middleware.ts   # auth gate
│   │   └── instrumentation.ts # scheduler bootstrap
│   ├── drizzle.config.ts
│   ├── astro.config.mjs
│   └── Dockerfile
│
├── scraper/                # Python FastAPI :8001 — page-by-page crawl + screenshot
│   ├── app/
│   │   ├── main.py         # FastAPI: /scrape, /scrape/status/{id}
│   │   ├── db.py           # SQLite (isti fajl kao GUI)
│   │   ├── page_scraper.py # httpx + trafilatura + extruct + lxml
│   │   ├── screenshot.py   # Playwright headless
│   │   ├── seo_metrics.py  # title/h1/word count/reading time
│   │   ├── sitemap_parser.py
│   │   └── jobs.py         # job store (in-memory)
│   ├── pyproject.toml
│   └── Dockerfile
│
├── scraper-leads/          # Python FastAPI :8002 — Google Maps + CSV
│   ├── src/maps_cold_calling/
│   │   ├── api.py          # /scrape-leads, /status, /progress, /changelog, /enrich-lead
│   │   ├── progress.py     # ProgressEvent v3 (7 stage-ova × 5 eventa)
│   │   ├── enrich.py       # fuzzy Google Maps lookup za postojeće leadove
│   │   └── …
│   ├── pyproject.toml
│   └── Dockerfile
│
├── deploy/                 # VPS deployment helperi
│   ├── setup-vps.sh        # kreira ~/outreach-data/, dodaje OUTREACH_DATA_DIR u .env
│   ├── backup-outreach.sh  # sqlite3 .backup + gzip + rotacija (7 dnevnih + 4 nedeljna)
│   ├── Caddyfile.vps.example # sistemski Caddy reverse proxy primer
│   └── README.md           # kompletan deployment vodič
│
├── docker-compose.yml          # lokalni: web (Next.js) + scraper + scraper-leads + caddy
├── docker-compose.astro.yml    # lokalni: gui-astro + scraper + scraper-leads + caddy
├── docker-compose.vps.yml      # VPS: gui-astro + scraper + scraper-leads (bez Caddy — sistemski)
│
├── data/                 # ⭐ SINGLE SOURCE OF TRUTH za SQLite
│   ├── outreach.db       # (gitignored)
│   ├── scraper-runs/     # CSV outputi + progress.json (gitignored)
│   └── screenshots/      # PNG-ovi po leadu (gitignored)
│
├── .env.example
├── .gitignore
├── AGENTS.md             # AI assistant pravila (DB lokacija, AUTH_PASSWORD, itd.)
└── README.md (ovaj fajl)
```

## Tech stack

| Sloj | Tehnologija |
|---|---|
| GUI framework | [Astro 7](https://astro.build/) SSR + standalone Node adapter |
| UI komponente | Custom (Card, Sidebar, ThemeToggle, …) + Tailwind v4 (`@theme` tokens, dark mode via `:root.dark`) |
| ORM | [Drizzle](https://orm.drizzle.team/) 0.38 + `better-sqlite3` 12 |
| Baza | SQLite 3 (WAL mode, `busy_timeout=10000`, single-user konkurentnost) |
| Auth | bcrypt (jedan korisnik, seeded) + HMAC-signed cookie, single-user gate middleware |
| Crypto | AES-256-GCM (SMTP šifre, IMAP password u settings) |
| Email | [nodemailer](https://nodemailer.com/) + SMTP sendere (multi-account, round-robin) |
| IMAP | [imapflow](https://github.com/postalsys/imapflow) |
| Scraping (page) | Python FastAPI + httpx + trafilatura + extruct + lxml + Playwright (Chromium) |
| Scraping (Maps) | Python FastAPI + Playwright Google Maps crawler, v3 progress events |
| AI | [MiniMax M3](https://api.minimax.io/) (text + vision) — vizuelna ocena, SEO sumar, email personalizacija |
| Scheduler | node-cron-like `setInterval` u `instrumentation.ts`, hot-reloadable iz settings |
| Build | Vite (Astro built-in), `npm run build` → standalone Node server |

## Env varijable

Sve env varijable imaju fallback u `SETTINGS_CATALOG` (DB → env → hardcoded default). Većina se može zameniti iz `/settings` UI bez restarta.

```bash
# --- Baza (single source of truth) ---
DATABASE_URL=file:../data/outreach.db      # container: file:/data/outreach.db

# --- Auth ---
AUTH_PASSWORD=<plain>                       # hešuje se u letu (ensureSeed)
AUTH_SECRET=<32-byte-hex>                   # HMAC cookie signing
AUTH_TRUST_HOST=true                        # iza reverse proxy-ja

# --- SMTP / Enkripcija ---
ENCRYPTION_KEY=<64-hex-chars>               # AES-256-GCM za SMTP šifre u DB

# --- Scrapers ---
SCRAPER_URL=http://scraper:8001             # page crawl
SCRAPER_LEADS_URL=http://scraper-leads:8002 # Google Maps

# --- AI ---
MINIMAX_API_KEY=<token>
MINIMAX_BASE_URL=https://api.minimax.io/v1
MINIMAX_MODEL=MiniMax-M3

# --- IMAP (reply tracking) ---
IMAP_HOST=imap.gmail.com
IMAP_PORT=993
IMAP_USER=marko@domen.rs
IMAP_PASSWORD=<app-password>                # ili u /settings
IMAP_FOLDER=INBOX
IMAP_POLL_MINUTES=5

# --- Scheduler ---
SCHEDULER_ENABLED=1                         # ili u /settings (scheduler_enabled)
SCHEDULER_TICK_MS=60000

# --- VPS deployment (automatski dodaje deploy/setup-vps.sh) ---
OUTREACH_DATA_DIR=/home/USER/outreach-data  # APSOLUTNA putanja, bind mount
UID=1000                                   # alpine node user u gui-astro kontejneru
GID=1000
```

## Podešavanja (DB-backed)

`/settings` je centralna runtime konfiguracija. Sidebar sa 7 sekcija, svaka kartica opisuje šta kontroliše.

| Sekcija | Šta kontroliše |
|---|---|
| **Slanje emaila** | Prozor slanja (HH:MM, TZ, dani), default cap-ovi za nove sendere, default delay |
| **Bounce guard** | Prag (%), prozor (dana), sample size — automatski pauzira sendere ako je rate visok |
| **Scheduler** | Enabled, tick interval (ms), batch size |
| **Scraper servisi** | URL-ovi, max strana po scrape-u, auto-screenshot toggle |
| **IMAP (reply tracking)** | Host, port, user, password, folder, SSL/TLS, poll interval |
| **Dashboard "Za zvanje danas"** | Follow-up prozor, no-contact prozor, max stavki u todo |
| **Unsubscribe** | Base URL za HMAC-signed unsubscribe link |

Sva podešavanja su u `gui-astro/src/lib/settings.ts` (`SETTINGS_CATALOG`) — dodaj novi setting tamo, pojaviće se u UI automatski.

**Izvor vrednosti** (redosled prioriteta): **DB** (`settings.key/value`) → **env** (`SETTINGS_CATALOG[key].envHint`) → **hardcoded default** (`SETTINGS_CATALOG[key].defaultValue`). UI prikazuje chip `db`/`env`/`default` pored svakog polja.

**Hot-reload vs restart:** scheduler `enabled`/`tick`/`batch` i scrape/imap URL-ovi se čitaju na svakom pozivu. `imap_secure` se čita pri svakoj IMAP konekciji. Restart servera je potreban samo za `scheduler_enabled` (čita se u `instrumentation.ts` pri startu).

## Scrape servisi

### Stari scraper (`scraper/`, port 8001)

- Endpoint: `POST /scrape { lead_id, max_pages }` → vraća `{ job_id }`
- Status: `GET /scrape/status/{job_id}`
- Crawl: sitemap.xml + kategorije + članci (heuristika + extruct microdata)
- Screenshot: Playwright Chromium, `wait_until="domcontentloaded"`, analytics blokada, 526KB output za prosečan sajt
- Čuva: `site_scrapes`, `site_pages`, `screenshots` tabele

### scraper-leads (`scraper-leads/`, port 8002)

- Endpoint-i: `/scrape-leads`, `/scrape-leads/status/{jobId}`, `/scrape-leads/progress/{jobId}`, `/scrape-leads/changelog`, `/enrich-lead`
- Google Maps Playwright crawler
- Progress events v3: 7 stage-ova × 5 eventa (`start`/`progress`/`end`/`skip`/`error`) — UI prikazuje progress bar sa stage labelama (srpski)
- Output: CSV + auto-import u `leads` tabelu
- Enrich: fuzzy Google Maps lookup po imenu za postojeće leadove (SequenceMatcher, threshold 0.45)

## Email attachments

PDF ponude, slike i drugi fajlovi koji se šalju uz email. **Template** može imati default attachment-e; **draft** može da ih override-uje.

### Arhitektura

```
[Browser] /attachments stranica
  ├─ drag&drop upload → POST /api/attachments (multipart)
  ├─ server validira (size, MIME) → SHA-256 → dedup ako već postoji
  ├─ čuva fajl na ~/outreach-data/attachments/<sha256>.<ext>
  └─ INSERT u `attachments` (id, original_name, mime, size, sha256)

[Browser] /templates editor
  └─ "Dodaj attachment" dropdown → bira iz biblioteke → INSERT u template_attachments

[Browser] queue/draft editor (TODO)
  └─ Override dugme → POST /api/email/drafts/<id>/attachments

[Scheduler] processQueue() pre slanja:
  1. Ako draft ima email_send_attachments → koristi SAMO njih (override)
  2. Inače ako email ima prompt_template_id → template_attachments
  3. Inače → []
  → nodemailer attachments: [{ filename, path }]
```

### Podešavanja

`/settings` → grupa **Email attachments**:

- `attachment_max_size_mb` (default 10) — max veličina po fajlu
- `attachment_allowed_mime` (default `application/pdf,image/jpeg,image/png,image/webp`) — comma-separated MIME lista

### Storage

- Fajlovi na hostu: `~/outreach-data/attachments/<sha256>.<ext>`
- Container path: `/data/attachments/<sha256>.<ext>` (kroz postojeći mount)
- **Dedup po SHA-256** — isti sadržaj se ne čuva dva puta (upload istog PDF-a → vrati postojeći ID)
- Backup skripta automatski tar-uje `attachments/` zajedno sa DB-om

### API

| Endpoint | Svrha |
|---|---|
| `POST /api/attachments` | Upload (multipart/form-data, polje `file`) |
| `GET /api/attachments` | List sa usage info |
| `GET /api/attachments/:id/file` | Download/preview binarno |
| `DELETE /api/attachments/:id` | Obriši (ako nije vezan ni za jedan template/draft) |
| `POST /api/templates/:id/attachments` | Veži na template |
| `DELETE /api/templates/:id/attachments` | Odveži sa template |
| `GET /api/templates/:id/attachments` | List template attachments |
| `POST /api/email/drafts/:id/attachments` | Override draft attachments |
| `DELETE /api/email/drafts/:id/attachments` | Ukloni override (vrati na template default) |

## Slanje emaila

`gui-astro/src/lib/workers/scheduler.ts` → `processQueue()`:

1. **Bounce guard** — ako je nedavni bounce rate > threshold (settings), svi senderi se pauziraju i scheduler preskače sve.
2. **Send window** — ako je trenutno vreme van prozora (HH:MM, TZ, dani), preskače se sve.
3. **Batch** — uzmi najstarijih N (settings `scheduler_batch_size`) queued emailova.
4. **Sender round-robin** — `pickNextSender()` bira najstariji `last_used_at` sender koji ima slobodnog cap-a.
5. **Pošalji** — nodemailer → SMTP, random delay u opsegu `[minDelaySec, maxDelaySec]` između dva maila.
6. **Ažuriraj** — `email_sends.status` → `sent` (ili `bounced`/`failed`), `senders.last_used_at`, `email_sends.messageId`.
7. **Bounce handling** — `5xx` SMTP response → `bounced` → lead u `blocklist` + status `do_not_contact`.

Per-sender `daily_cap` / `hourly_cap` / `min_delay_sec` / `max_delay_sec` su u `senders` tabeli (editabilni na `/senders`).

## IMAP reply tracking

`gui-astro/src/lib/email/imap.ts` → `pollImap()`:

1. Svakih `imap_poll_minutes` minuta, otvori IMAP konekciju (SSL/TLS po `imap_secure`).
2. Učitaj sve UID-ove od poslednjeg viđenog (čuva se u `settings.imap_last_uid`).
3. Za svaki novi email:
   - **Alias match** — `from` adresa == `lead.email` → match.
   - **Thread match** — `In-Reply-To` header == `email_sends.messageId` → match.
4. Ako match:
   - Upis u `email_replies` (ne čuvamo telo zbog privatnosti).
   - Svi `sent` emailovi za lead → `replied = true`.
   - Svi `queued` za lead → `status = "failed"`, `error = "Reply — sekvenca stopirana"`.
   - Lead → status "Odgovorio" (ako postoji).
5. Sačuva `max(uid)` kao `imap_last_uid`.

## Baza podataka

**Single source of truth: `data/outreach.db`**

- Svi kontejneri (gui-astro, scraper, scraper-leads) dele isti fajl preko bind mount-a (`./data:/data`).
- WAL mode + `busy_timeout=10000` → single-user konkurentnost bez lock-ova.
- Shema: `gui-astro/src/lib/db/schema.ts` (Drizzle) — generiši migracije sa `cd gui-astro && npx drizzle-kit generate`, primeni sa `npm run db:migrate`.
- **NIKAD** `web/outreach.db` — to pravi novi prazan SQLite zbog relativne putanje.

### Glavne tabele

| Tabela | Svrha |
|---|---|
| `users` | single-user bcrypt hash |
| `leads` | glavna baza biznisa (campaign_id, status_id, email, website, google_rating, …) |
| `campaigns` | outreach kampanje (kategorija + grad) |
| `statuses` | pipeline statusi (Aktivan, Odgovorio, Won, Lost, …) |
| `site_scrapes` / `site_pages` | scrape output po leadu |
| `screenshots` | PNG path po leadu |
| `site_analysis` | M3 vizuelna + SEO ocena (1-10) |
| `prompt_templates` | AI promptovi (email_personalization, score, seo_summary, assistant) |
| `senders` | SMTP nalozi (host, port, encrypted password, cap-ovi, delay) |
| `sequences` / `sequence_steps` | outreach sekvence (više emailova po leadu) |
| `email_sends` | draft → queued → sent → (failed/bounced), sa `messageId`, `opened_count`, `replied` |
| `email_replies` | reply-evidencija (bez tela, samo from/subject/matchedBy) |
| `blocklist` | do-not-contact leadovi |
| `ai_chats` | chat istorija (JSON blob) |
| `audit_log` | bulk_delete, enrich, lead promene, settings.change |
| `settings` | DB-backed runtime config key/value |

## Backup

Jedna skripta, sve na VPS-u:

```bash
./deploy/backup-outreach.sh
```

- `sqlite3 .backup` (online, WAL-safe, bez lock-a)
- gzip + rotacija (zadano: 7 dnevnih + 4 nedeljna)
- opciono tar-uje `scraper-runs/`
- za off-site sync: otkomentariši `rsync` liniju na dnu skripte

Preporuka — crontab:

```bash
(crontab -l; echo "0 3 * * * $HOME/outreach/deploy/backup-outreach.sh >> \$HOME/.outreach-backup.log 2>&1") | crontab -
```

Restore: vidi [`deploy/README.md`](./deploy/README.md).

## VPS deployment

Kompletan vodič u [`deploy/README.md`](./deploy/README.md). Kratko:

```bash
# 1. Kloniraj
git clone https://github.com/djordjeveljkovic/outreach.git ~/outreach && cd ~/outreach
cp .env.example .env  # uredi

# 2. Data folder na hostu (van repo)
./deploy/setup-vps.sh
# → kreira ~/outreach-data/{scraper-runs,screenshots}
# → chmod 700, dodaje OUTREACH_DATA_DIR/UID/GID u .env

# 3. Sistemski reverse proxy
sudo cp deploy/Caddyfile.vps.example /etc/caddy/sites/outreach.caddy
sudoedit /etc/caddy/sites/outreach.caddy  # zameni outreach.example.com sa tvojim domenom
sudo systemctl reload caddy

# 4. Build + start
docker compose -f docker-compose.vps.yml --env-file .env up -d --build

# 5. Backup cron
(crontab -l; echo "0 3 * * * $HOME/outreach/deploy/backup-outreach.sh >> ~/.outreach-backup.log 2>&1") | crontab -
```

`gui-astro` kontejner je izložen samo na `127.0.0.1:3000` — reverse proxy gleda unutra. Compose NE sadrži Caddy kontejner — koristi se sistemski Caddy/Nginx na hostu.

## Razvoj

```bash
cd gui-astro

# Typecheck (Astro check)
npm run typecheck

# Lint
npm run lint

# Build (testira SSR)
npm run build

# Drizzle migracije
npx drizzle-kit generate   # generiši SQL iz schema.ts
npm run db:migrate         # primeni

# Ručno pokreni scheduler tick (za testiranje bez čekanja intervala)
curl -X POST http://localhost:3000/api/admin/tick

# IMAP poll jednom
curl -X POST http://localhost:3000/api/admin/imap-poll
```

Audit log akcije: `lead.create`, `lead.update`, `lead.delete`, `lead.status_change`, `lead.bulk_delete`, `lead.bulk_status`, `lead.bulk_blocklist`, `lead.import`, `scrape.start`, `scrape.complete`, `analyze.start`, `analyze.complete`, `settings.change`, `campaign.create`, `campaign.delete`. Vidi se na `/audit`.

## Licenca

Privatno. Nema javne licence.