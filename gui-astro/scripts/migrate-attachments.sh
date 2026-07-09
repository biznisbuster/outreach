#!/usr/bin/env bash
# ============================================================================
# migrate-attachments.sh — primeni attachments migraciju
# ----------------------------------------------------------------------------
# Radi na lokalu (DATABASE_URL=file:../data/outreach.db) i VPS-u
# (DATABASE_URL=file:/data/outreach.db). Idempotentan — može se pokrenuti
# više puta.
#
# Pokretanje:
#   npm run db:migrate-attachments              # koristi DATABASE_URL env
#   DATABASE_URL=file:/data/outreach.db npm run db:migrate-attachments   # eksplicitno
#
# Ako ne radi, vidi "Troubleshooting" na dnu.
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL="$SCRIPT_DIR/../migrations/0001_attachments.sql"
DB_URL="${DATABASE_URL:-file:../data/outreach.db}"
DB_PATH="${DB_URL#file:}"

# Relativnu putanju resolve-uj u odnosu na gui-astro/ (NE na CWD)
if [[ "$DB_PATH" != /* ]]; then
  DB_PATH="$SCRIPT_DIR/../$DB_PATH"
fi

RED=$'\033[31m'; GRN=$'\033[32m'; YEL=$'\033[33m'; NC=$'\033[0m'
ok()   { echo "${GRN}✓${NC} $*"; }
warn() { echo "${YEL}!${NC} $*"; }
err()  { echo "${RED}✗${NC} $*" >&2; }
hr()   { echo "─────────────────────────────────────────────────"; }

hr
echo "Outreach — attachments migracija"
hr
echo
echo "DATABASE_URL (env): ${DATABASE_URL:-<nije postavljen>}"
echo "DB path (resolved): $DB_PATH"
echo "SQL file:           $SQL"
echo

# ─── Pre-flight provere ────────────────────────────────────────────────

if [ ! -f "$SQL" ]; then
  err "SQL fajl ne postoji: $SQL"
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  err "sqlite3 CLI nije instaliran."
  echo "  Debian/Ubuntu:  sudo apt install sqlite3"
  echo "  Alpine:         apk add sqlite"
  exit 2
fi

if [ ! -f "$DB_PATH" ]; then
  err "Baza ne postoji: $DB_PATH"
  echo "  Proveri DATABASE_URL env var ili putanju do .db fajla."
  echo
  echo "  Ako si na VPS-u i očekuješ /data/outreach.db:"
  echo "    ls -la /data/outreach.db"
  echo "    env | grep -i database"
  exit 3
fi

# Proveri da li je već migrirano (idempotentnost check)
EXISTING=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('attachments','template_attachments','email_send_attachments');" 2>/dev/null || echo "?")
echo "Pre-flight: $EXISTING/3 attachments tabela već postoji."

if [ "$EXISTING" = "3" ]; then
  ok "Sve 3 tabele već postoje — nema šta da se radi."
  exit 0
fi

# ─── Primeni SQL ──────────────────────────────────────────────────────

echo
echo "Primenjujem SQL..."
sqlite3 "$DB_PATH" < "$SQL"
ok "SQL primenjen."
echo

# ─── Verifikacija ─────────────────────────────────────────────────────

AFTER=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN ('attachments','template_attachments','email_send_attachments');")
echo "Posle: $AFTER/3 attachments tabela postoji."

if [ "$AFTER" != "3" ]; then
  err "Migracija nije uspela — očekivano 3 tabele, dobijeno $AFTER."
  exit 4
fi

# Prikaži šta je tačno kreirano
echo
echo "Kreirano:"
sqlite3 -header -column "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%attachment%' ORDER BY name;"

ok "Gotovo."
echo
hr
echo "VAŽNO: Restart-uj gui-astro server posle migracije!"
echo "       (Ako je već pokrenut, SQLite kešira šemu konekcije)"
hr