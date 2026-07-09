# Outreach — VPS Deployment

Ovaj folder sadrži sve što treba da pokreneš Outreach (Astro GUI + 2 scrapera) na
VPS-u jednim `docker compose up`.

## Arhitektura

```
Browser → Caddy/Nginx (sistemski, na hostu :443)
            │
            └─→ 127.0.0.1:3000 → gui-astro kontejner
                                  ├─ Astro standalone
                                  └─ DATABASE_URL=file:/data/outreach.db
                                                │
                          ┌─────────────────────┼─────────────────────┐
                          ↓                     ↓                     ↓
                   ~/outreach-data/      scraper kontejner    scraper-leads
                   (HOST, van repo)      (DATABASE_PATH)      (RUNS_DIR)
```

**Ključno:** baza živi na hostu u `~/outreach-data/` (van repo foldera), a reverse
proxy radi sistemski na VPS-u (NE u compose-u). Ovo znači:

- `~/outreach-data/` se ne gubi pri `git pull` + redeploy.
- Backup je trivijalan — `~/outreach-data/` je samo običan folder.
- Caddy/Nginx možeš da deliš sa drugim sajtovima na VPS-u.

## Setup na novom VPS-u

```bash
# 1. Kloniraj (ili rsync sa lokalnog)
git clone <repo> ~/outreach && cd ~/outreach
# ili: rsync -av --exclude=node_modules --exclude=.next --exclude=dist ./ user@vps:~/outreach/

# 2. Env
cp .env.example .env
# uredi .env — obavezno:
#   AUTH_PASSWORD=<plain>
#   AUTH_SECRET=$(openssl rand -hex 32)
#   ENCRYPTION_KEY=$(openssl rand -hex 32)
#   MINIMAX_API_KEY=<token>
#   IMAP_USER / IMAP_PASSWORD (opciono, za reply tracking)
#   UNSUBSCRIBE_BASE_URL=https://outreach.tvojdomen.rs

# 3. Data folder (kreira ~/outreach-data + upisuje OUTREACH_DATA_DIR u .env)
./deploy/setup-vps.sh

# 4. Sistemski reverse proxy — vidi dole
sudo cp deploy/Caddyfile.vps.example /etc/caddy/sites/outreach.caddy
# zameni outreach.example.com sa svojim domenom
sudoedit /etc/caddy/sites/outreach.caddy
# dodaj u /etc/caddy/Caddyfile:   import /etc/caddy/sites/*.caddy
sudo systemctl reload caddy

# 5. Build + start
cd ~/outreach
docker compose -f docker-compose.vps.yml --env-file .env up -d --build

# 6. Proveri
docker compose -f docker-compose.vps.yml ps
docker compose -f docker-compose.vps.yml logs -f gui-astro
```

## Reverse proxy

**Caddy (preporuka — automatski Let's Encrypt):**

```bash
sudo apt install -y caddy
sudo cp deploy/Caddyfile.vps.example /etc/caddy/sites/outreach.caddy
sudoedit /etc/caddy/sites/outreach.caddy   # zameni domen
# u /etc/caddy/Caddyfile dodaj: import /etc/caddy/sites/*.caddy
sudo systemctl reload caddy
```

Caddy automatski izdaje sertifikat čim vidi saobraćaj na domen. Portovi 80 i 443
moraju biti otvoreni na hostu.

**Nginx:** primer konfiguracije je na dnu `Caddyfile.vps.example`. Koristi
`certbot --nginx -d outreach.tvojdomen.rs` za TLS.

**Bez proxy-ja (testiranje):**

Ako samo testiraš, promeni port mapping u `docker-compose.vps.yml` sa
`"127.0.0.1:3000:3000"` na `"3000:3000"` i pristupi `http://VPS_IP:3000`. **Ne
za produkciju** — nema TLS.

## Bekap

```bash
# 1. Ručno
./deploy/backup-outreach.sh

# 2. Automatski, svaku noć u 03:00
(crontab -l 2>/dev/null; echo "0 3 * * * $HOME/outreach/deploy/backup-outreach.sh >> \$HOME/.outreach-backup.log 2>&1") | crontab -
```

Bekapi se čuvaju u `~/outreach-backups/{daily,weekly}/`, automatski se rotira
(7 dnevnih + 4 nedeljna). Za off-site backup otkomentariši `rsync` liniju na dnu
`backup-outreach.sh` i podesi `DEST`.

**Restore:**

```bash
# Zaustavi gui-astro da ne piše u DB
docker compose -f docker-compose.vps.yml stop gui-astro

# Vrati bekapa
gunzip -c ~/outreach-backups/daily/outreach-2026-07-09.db.gz \
    > ~/outreach-data/outreach.db

# Pokreni ponovo
docker compose -f docker-compose.vps.yml start gui-astro
```

> **WAL napomena:** ako si bekapovao dok je app radila i imaš i
> `outreach.db-shm` / `outreach.db-wal` fajlove, vrati i njih zajedno sa
> `.db`-om na isto mesto. `sqlite3 .backup` (koji koristi backup skripta) to već
> rešava — `-shm`/`-wal` su u tom trenutku konsistentni sa `.db`-om.

## Redovne operacije

```bash
# Update koda
cd ~/outreach
git pull
docker compose -f docker-compose.vps.yml --env-file .env up -d --build

# Logovi
docker compose -f docker-compose.vps.yml logs -f --tail=100

# Status (healthcheck status)
docker compose -f docker-compose.vps.yml ps

# Restart samo gui-astro (npr. posle env promene)
docker compose -f docker-compose.vps.yml restart gui-astro

# Backup pre rizične operacije
./deploy/backup-outreach.sh

# Disk usage
du -sh ~/outreach-data/* 2>/dev/null
du -sh ~/outreach-backups/* 2>/dev/null
```

## ENV varijable specifične za VPS

`./deploy/setup-vps.sh` automatski dodaje u `.env`:

- `OUTREACH_DATA_DIR=/home/USER/outreach-data` — apsolutna putanja do data
  foldera na hostu. **NE menjaj** osim ako premeštaš folder.
- `UID=1000` i `GID=1000` — UID/GID vlasnika data foldera. gui-astro radi kao
  alpine `node` user (UID 1000). Ako je tvoj VPS user UID=1001, automatski se
  overriduje.

Compose `environment:` sekcija override-uje `DATABASE_URL`, `SCRAPER_URL`,
`SCRAPER_LEADS_URL`, `HOST`, `PORT`, `NODE_ENV`, `AUTH_TRUST_HOST` — ove ne
treba da menjaš u `.env`.

## Troubleshooting

**Permission denied na bind mount:**

```bash
# Proveri UID
id -u
# Ako je != 1000, u .env postavi UID/GID ili:
chmod -R a+rwX ~/outreach-data
```

**Caddy ne izdaje TLS:**

- Domena mora da pokazuje (A/AAAA record) na VPS IP.
- Port 80 otvoren na firewall-u (`ufw allow 80/tcp`).
- `caddy logs` za detalje.

**Astro se žali na `DATABASE_URL`:**

- U kontejneru, validna putanja je `file:/data/outreach.db` (NE
  `file:../data/...`). Compose to već postavlja — ne diraj.

**Baza se "gubi" nakon `docker compose down`:**

- Bind mount čuva podatke, brisanje kontejnera ne dira `~/outreach-data/`.
- Ali `docker compose down -v` briše volume-e — nema ih u ovom compose-u, ali
  ne koristi `-v` za svaki slučaj.