# Outreach GUI — Astro v7

Lak, brz i pouzdan rewrite Outreach GUI-ja. Zamenjuje `web/` (Next.js 16 + React 19 + tRPC + Drizzle) sa **Astro v7 + Node adapter + ista Drizzle/better-sqlite3 baza**.

> Stari Next.js GUI je netaknut u `web/`. Ovaj `gui-astro/` je drop-in zamena istog DB-a. Možeš da imaš oba pokrenuta paralelno ili da prebaciš Caddy reverse_proxy na ovaj.

## Šta je isto

- **Ista baza** — `data/outreach.db` (WAL, 18 Drizzle tabela + audit_log). Bez migracija; `gui-astro/` čita iste fajlove i koristi iste `web/drizzle/` migracije ako već imaš.
- **Isti look** — Tailwind v4, iste boje i CSS varijable, ista sidebar navigacija, isti Inter font.
- **Isti auth model** — bcrypt single-user + signed HttpOnly cookie (`outreach_sid`).
- **Isti API surface** — iste rute, isti JSON payload-ovi (konzumenti koji već zovu `/api/leads`, `/api/scrape` itd. rade identično).
- **Isti scheduler** — `setInterval`-baziran queue tick + IMAP reply poller.

## Šta je **uklonjeno** (jer je AI)

- `lib/minimax.ts`, `lib/ai/tools.ts`
- `/api/email/generate*`, `/api/email/drafts/[id]/approve`
- `/api/ai/chat`, `chat-panel.tsx`
- `/api/analyze/[leadId]` (M3 vizuelna + SEO ocena)
- `/api/leads/bulk-jobs` (bulk AI analyze sekvenca)
- `/api/settings/test-minimax`
- Lead detail "AI generate email" / "AI analyze" dugmad
- `minimax_*` environment vars i settings catalog
- AI tipovi u `prompt_templates` (ostaju samo "manual" placeholder-i)

Sekvence (`sequences` / `sequence_steps`) ostaju u bazi radi kompatibilnosti, ali `advanceSequence()` je no-op (bez AI ne generiše sledeći draft automatski).

## Šta je **dodata**

- `@/lib/*` path alias (umesto `@/lib/*` Next.js stila — isti naziv, Astro vite resolve pravilo).
- Server-side form handleri (npr. `/leads/new` POST → redirect) — nema React forme.
- `instrumentation.ts` — scheduler se pokreće pri startu ako je `SCHEDULER_ENABLED=1` ili `NODE_ENV=production`.
- JEDAN Dockerfile, JEDAN container slot (`gui-astro`), JEDAN set env varijabli.
- Sva dugmad/akcije su sada `<form method="POST">` sa server redirect-om, radi manjeg JS footprint-a.

## Struktura

```
gui-astro/
├── astro.config.mjs           # server output + node standalone + tailwind vite plugin
├── Dockerfile
├── drizzle.config.ts          # koristi ../data/outreach.db
├── package.json
├── tsconfig.json
├── src/
│   ├── env.d.ts
│   ├── instrumentation.ts     # DB init + scheduler boot
│   ├── middleware.ts          # auth gate (cookie)
│   ├── layouts/
│   │   └── AppLayout.astro    # shell + Inter + sidebar wrapper
│   ├── components/
│   │   ├── Sidebar.astro
│   │   ├── Card.astro         # card + CardHeader/CardTitle/CardDescription/CardContent
│   │   └── Button.astro       # 5 varijanti
│   ├── lib/
│   │   ├── db/               # schema + drizzle connector (deli istu shemu sa web/)
│   │   ├── crypto.ts         # AES-256-GCM + HMAC
│   │   ├── session.ts        # signed cookie (replaces next-auth)
│   │   ├── auth.ts           # bcrypt verify + ensureSingleUser
│   │   ├── seed.ts           # statusi (AI promptovi uklonjeni)
│   │   ├── settings.ts       # DB-backed runtime (MiniMax keys izbačeni)
│   │   ├── audit.ts
│   │   ├── dashboard.ts      # "Za zvanje danas" todo
│   │   ├── dedup.ts          # website/phone/name+city normalizacija
│   │   ├── api.ts            # ok/bad/notFound + Drizzle re-exports
│   │   ├── utils.ts          # cn / formatNumber / formatters
│   │   ├── scraping/client.ts # proxy ka Python servisu
│   │   ├── email/
│   │   │   ├── sender.ts     # nodemailer send + transporterCache
│   │   │   ├── throttler.ts  # cap + send window + bounce guard
│   │   │   ├── sequence.ts   # no-op advance (bez AI)
│   │   │   └── imap.ts       # imapflow reply tracker
│   │   └── workers/
│   │       └── scheduler.ts  # setInterval(queue tick + IMAP poll)
│   ├── pages/
│   │   ├── index.astro       # / — dashboard
│   │   ├── login.astro
│   │   ├── leads/
│   │   │   ├── index.astro
│   │   │   ├── new.astro
│   │   │   ├── [id].astro
│   │   │   └── [id]/{status,comment,block,unblock,scrape,new-email}.ts
│   │   ├── campaigns/
│   │   │   ├── index.astro
│   │   │   └── [id].astro    # scrape launcher inline
│   │   ├── import.astro      # CSV/JSON preview + commit
│   │   ├── senders.astro
│   │   ├── queue.astro
│   │   ├── inbox.astro
│   │   ├── templates.astro
│   │   ├── settings.astro
│   │   ├── audit.astro
│   │   └── api/
│   │       ├── auth/{login,logout}.ts
│   │       ├── campaigns.ts + [id].ts + create.ts
│   │       ├── leads.ts + [id].ts + bulk.ts + [id]/{comments,enrich}.ts
│   │       ├── statuses.ts
│   │       ├── senders.ts + [id].ts
│   │       ├── scrape.ts + status/[jobId].ts
│   │       ├── scrape-leads.ts + status/[jobId].ts + progress/[jobId].ts + changelog.ts + import.ts
│   │       ├── screenshot/[leadId].ts
│   │       ├── queue.ts
│   │       ├── inbox.ts
│   │       ├── sequences.ts + steps.ts + steps/[id].ts
│   │       ├── prompts.ts + [id].ts
│   │       ├── import.ts + commit.ts
│   │       ├── audit.ts
│   │       ├── settings/{save,test-imap}.ts
│   │       ├── admin/{tick,imap-poll}.ts
│   │       └── unsubscribe.ts (no-auth)
│   └── styles/globals.css     # tailwind v4 + shadcn-like tokens
└── public/favicon.svg
```

## Brzo pokretanje (dev)

```bash
cd gui-astro
npm install
# DATABASE_URL i AUTH_PASSWORD su već u .env
npm run dev
# → http://localhost:3000
# login: outreach123
```

Ako nema baze, `middleware.ts` + `instrumentation.ts` će je kreirati i seed-ovati. Ako imaš bazu iz Next run-a — on i dalje čita isti fajl.

## Produkcija (Docker)

```bash
# Cela nova stack (Astro GUI + isti scrapers + caddy):
docker compose -f docker-compose.astro.yml up -d --build

# ILI, drži Next pokrenut i dodaj Astro kao alternativu:
#   izmeni Caddyfile da reversira na gui-astro:3000 umesto web:3000
#   i dodaj 'gui-astro' servis iz docker-compose.astro.yml
```

## Env varijable

Ista `.env.example` kao Next verzija — nema novih obaveznih varijabli. `minimax_*` varijable su ignorisane (nema ih u settings katalogu).

## Reverse-proxy / OAuth

Nema CSRF tokena za form POST-ove — Astro v7 po defaultu blokira cross-origin form submissions (radi browser bezbednosti). Za reverse-proxy iza Caddy-ja nema dodatne konfiguracije, cookie `outreach_sid` se postavlja sa `Path=/`.

## Perms

`data/outreach.db` je isti fajl. **Ako preskačeš između Next i Astro**, zaustavi jednu pre nego što drugu pokreneš (WAL write lock) — inače ćeš videti `SQLITE_BUSY`. Ako upadneš u to, čekaj 5s (busy_timeout=5000ms) ili restart.

## Veliki win

- Skidanje React 19 + Next runtime → ~150 MB manje node_modules
- Bez hydration po stranici (Astro server-renders by default)
- Manje feature surface → manje bugova
- Ista baza, isti look, isti workflow
