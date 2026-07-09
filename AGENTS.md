# AGENTS.md — pravila za AI asistente na ovom projektu

## Baza podataka — strogo jedno mesto

**Canonical lokacija:** `data/outreach.db` (relativno od `web/`: `DATABASE_URL=file:../data/outreach.db`).

### Obavezna pravila

1. **Nikad ne stvaraj `web/outreach.db*`** — ako `.env` ima `DATABASE_URL=file:./outreach.db` ili nešto slično, to je BUG. Ispravi na `file:../data/outreach.db`.
2. **Ako vidiš `web/outreach.db`, `web/outreach.db-shm` ili `web/outreach.db-wal`** — obriši odmah i proveri `.env`. To je znak da je neko greškom kreirao lokalnu bazu i potencijalno izgubio podatke.
3. **Nikad ne radi `rm data/outreach.db*` osim ako korisnik to eksplicitno traži.** To su produkcijski podaci.
4. **Nikad ne pokreći seed/test skripte koje pišu u bazu** bez prethodne provere da je `DATABASE_URL` ispravno postavljen.
5. **Docker compose i lokalni dev dele isti fajl** — `../data` u lokalu je `/data` u kontejneru.

### Brza dijagnostika

```bash
# Da li postoji stray DB?
ls web/outreach.db* 2>/dev/null && echo "BUG: obriši"
ls gui-astro/outreach.db* 2>/dev/null && echo "BUG: obriši"

# Da li je .env ispravan?
grep DATABASE_URL web/.env        # treba: file:../data/outreach.db
grep DATABASE_URL gui-astro/.env  # treba: file:../data/outreach.db

# Koliko leadova?
node -e "const D=require('web/node_modules/better-sqlite3'); const d=new D('data/outreach.db',{readonly:true}); console.log(d.prepare('SELECT COUNT(*) c FROM leads').get())"
```

## Dva GUI-a: `web/` (Next.js) i `gui-astro/` (Astro v7)

I `web/` i `gui-astro/` koriste **istu bazu** (`data/outreach.db`). Svi env (`AUTH_PASSWORD`, `ENCRYPTION_KEY`, `SCRAPER_URL` itd.) su isti.

- Next port: 3000 (default).
- Astro port: 3000 (default, podesi preko `PORT` env).
- Ne pokreći **oba odjednom** sa default portom — uvek koristiti različite portove ili ugasiti jedan pre drugog (WAL write lock).
- Astro verzija nema AI deo (`/api/email/generate`, `/api/ai/chat`, `/api/analyze`, `/lib/minimax*`); ne dodaj AI-dependencies nazad.
- Astro koristi **identičnu Drizzle shemu** (`src/lib/db/schema.ts`) — nema schema izmena. Ako menjaš schema, uradi to u oba projekta ili prebaci se potpuno na jedan.

## AUTH_PASSWORD vs AUTH_PASSWORD_HASH

`AUTH_PASSWORD_HASH` (bcrypt) u `.env` je **opasan** jer `$2a$10$...` vrednost biva interpretirana kao shell/dotenv varijabla i hash se lomi. Koristi **`AUTH_PASSWORD=<plain>`** — `ensureSeed()` u `web/src/lib/seed.ts` će ga hešovati u letu.

## Middleware vs Proxy

Next.js 16 podržava oba naziva (`middleware.ts` i `proxy.ts`). Ako se koristi `next-auth/middleware`, drži `middleware.ts` radi kompatibilnosti. Preimenovanje `proxy.ts` → `middleware.ts` (ili obrnuto) radi, ali ne mešati.

## Pre commit-a / pre brisanja

- Nikad `git add .` slepo — uvek `git status` i `git diff` prvo.
- `web/.env` je lokalni, ne commituj.
- `data/*` (osim `.gitkeep`) je gitignored — commitovanje DB-a je zabranjeno.