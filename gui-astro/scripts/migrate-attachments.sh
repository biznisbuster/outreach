#!/usr/bin/env bash
# ============================================================================
# migrate-attachments.sh — primeni attachments migraciju
# ----------------------------------------------------------------------------
# Radi na lokalu (DATABASE_URL=file:../data/outreach.db) i VPS-u
# (DATABASE_URL=file:/data/outreach.db). Idempotentan — može se pokrenuti
# više puta.
#
# Pokretanje:  npm run db:migrate-attachments
# ============================================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SQL="$SCRIPT_DIR/../migrations/0001_attachments.sql"

# Izvuci path iz DATABASE_URL (file:...)
DB_URL="${DATABASE_URL:-file:../data/outreach.db}"
DB_PATH="${DB_URL#file:}"

# Ako je relativna putanja, resolve-uj u odnosu na gui-astro/
if [[ "$DB_PATH" != /* ]]; then
  DB_PATH="$SCRIPT_DIR/../$DB_PATH"
fi

if [ ! -f "$SQL" ]; then
  echo "✗ SQL fajl ne postoji: $SQL" >&2
  exit 1
fi

if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "✗ sqlite3 CLI nije instaliran (apt install sqlite3 / apk add sqlite)." >&2
  exit 2
fi

if [ ! -f "$DB_PATH" ]; then
  echo "✗ Baza ne postoji: $DB_PATH" >&2
  echo "  Proveri DATABASE_URL env var." >&2
  exit 3
fi

echo "Baza:  $DB_PATH"
echo "SQL:   $SQL"
echo

sqlite3 "$DB_PATH" < "$SQL"

echo "✓ Gotovo."
echo
echo "Verifikacija:"
sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('attachments','template_attachments','email_send_attachments') ORDER BY name;"