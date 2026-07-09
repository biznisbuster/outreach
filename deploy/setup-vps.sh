#!/usr/bin/env bash
# ============================================================================
# setup-vps.sh — pripremi VPS za Outreach deployment
# ----------------------------------------------------------------------------
# Radi JEDNOM na novom VPS-u pre prvog `docker compose up`:
#   1. Kreira ~/outreach-data/ (DB + scraper output).
#   2. Upisuje OUTREACH_DATA_DIR / UID / GID u .env (ako ih nema).
#   3. Opciono pokreće `drizzle-kit migrate` za početnu shemu.
#
# Idempotentan: bezbedno ponovo pokrenuti.
# ============================================================================
set -euo pipefail

# Repo root (jedan dir iznad deploy/)
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# Podrazumevana lokacija data foldera — korisnikov $HOME/outreach-data
DATA_DIR="${OUTREACH_DATA_DIR:-$HOME/outreach-data}"

# UID/GID detekcija (default 1000 = prvi user na Ubuntu/Debian)
DETECTED_UID="$(id -u 2>/dev/null || echo 1000)"
DETECTED_GID="$(id -g 2>/dev/null || echo 1000)"

echo "→ Outreach setup na $(uname -n)"
echo "  Repo:  $REPO_ROOT"
echo "  Data:  $DATA_DIR"
echo "  UID:GID = $DETECTED_UID:$DETECTED_GID"
echo

# 1. Struktura
mkdir -p "$DATA_DIR/scraper-runs" "$DATA_DIR/screenshots"

# Default prava: 755 (owner može da piše, group/other samo čitaju).
# Ako tvoj UID nije 1000 (alpine node user u gui-astro), pročitaj napomenu ispod.
chmod 755 "$DATA_DIR"
chmod 755 "$DATA_DIR/scraper-runs" "$DATA_DIR/screenshots"

# 2. .env — dopuni ako fali
ENV_FILE="$REPO_ROOT/.env"
if [ ! -f "$ENV_FILE" ]; then
  echo "✗ Nema $ENV_FILE — prvo kopiraj .env.example:"
  echo "    cp $REPO_ROOT/.env.example $ENV_FILE"
  echo "  pa ga uredi (AUTH_PASSWORD, ENCRYPTION_KEY, MINIMAX_API_KEY, …) i ponovo pokreni ovu skriptu."
  exit 1
fi

add_env_var() {
  local key="$1" value="$2" comment="$3"
  if grep -qE "^${key}=" "$ENV_FILE"; then
    echo "  · $key već postoji u .env (ne menjam)"
  else
    echo "" >> "$ENV_FILE"
    [ -n "$comment" ] && echo "# $comment" >> "$ENV_FILE"
    echo "${key}=${value}" >> "$ENV_FILE"
    echo "  ✓ Dodao $key=$value u .env"
  fi
}

echo "→ Ažuriram $ENV_FILE"
add_env_var "OUTREACH_DATA_DIR" "$DATA_DIR" "Lokacija data foldera na hostu (van repo)"
add_env_var "UID" "$DETECTED_UID" "UID vlasnika ~/outreach-data — gui-astro alpine node user"
add_env_var "GID" "$DETECTED_GID" "GID vlasnika ~/outreach-data"

# 3. Rezime
echo
echo "✓ Struktura:"
ls -la "$DATA_DIR"
echo
echo "Sledeći korak:"
echo "  cd $REPO_ROOT"
echo "  docker compose -f docker-compose.vps.yml --env-file .env up -d --build"
echo
echo "Napomena za permissions:"
echo "  gui-astro u kontejneru radi kao alpine 'node' user (UID 1000)."
echo "  Ako tvoj VPS user ima UID=$DETECTED_UID (≠1000), može doći do"
echo "  permission denied pri pisanju u ~/outreach-data. Rešenje — u .env:"
echo "    UID=$DETECTED_UID"
echo "    GID=$DETECTED_GID"
echo "  (setup skripta ih je već upisala, proveri .env)."