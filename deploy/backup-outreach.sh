#!/usr/bin/env bash
# ============================================================================
# backup-outreach.sh — dnevni backup Outreach baze i scraper output-a
# ----------------------------------------------------------------------------
# Radi i sa WAL mode-om: koristi `sqlite3 .backup` (online, bez lock-a).
# Drži KEEP_DAILY dnevnih + KEEP_WEEKLY nedeljnih bekapa. Starije briše.
#
# Preporuka — crontab:
#   0 3 * * * /home/USER/outreach/deploy/backup-outreach.sh >> ~/.outreach-backup.log 2>&1
#
# ENV varijable (opciono, sve imaju default):
#   OUTREACH_DATA_DIR   — lokacija data foldera (default ~/outreach-data)
#   OUTREACH_BACKUP_DIR — gde se čuvaju bekapi (default ~/outreach-backups)
#   KEEP_DAILY=7
#   KEEP_WEEKLY=4
# ============================================================================
set -euo pipefail

DATA_DIR="${OUTREACH_DATA_DIR:-$HOME/outreach-data}"
BACKUP_DIR="${OUTREACH_BACKUP_DIR:-$HOME/outreach-backups}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"

TODAY="$(date +%F)"

log() { echo "[$(date +%H:%M:%S)] $*"; }
err() { echo "[$(date +%H:%M:%S)] ✗ $*" >&2; }

DB="$DATA_DIR/outreach.db"
if [ ! -f "$DB" ]; then
  err "Nema $DB — preskačem"
  exit 1
fi

mkdir -p "$BACKUP_DIR/daily" "$BACKUP_DIR/weekly"

# 1. SQLite online backup (WAL-safe, čak i dok gui-astro piše).
DAILY="$BACKUP_DIR/daily/outreach-$TODAY.db"

if ! command -v sqlite3 >/dev/null 2>&1; then
  err "sqlite3 CLI nije instaliran. apt install sqlite3 (ili apk add sqlite)."
  exit 2
fi

log "DB backup → $DAILY"
sqlite3 "$DB" ".backup '$DAILY'"
gzip "$DAILY"
log "  ✓ $(basename "$DAILY").gz ($(du -h "$DAILY.gz" | cut -f1))"

# 2. Nedeljni bekapa (ponedeljak = kopija današnjeg dnevnog)
if [ "$(date +%u)" = "1" ]; then
  cp "$DAILY.gz" "$BACKUP_DIR/weekly/outreach-$TODAY.db.gz"
  log "  ✓ weekly: outreach-$TODAY.db.gz"
fi

# 3. Scraper runs (CSV-ovi, nisu kritični ali lepo ih je imati)
if [ -d "$DATA_DIR/scraper-runs" ] && [ -n "$(ls -A "$DATA_DIR/scraper-runs" 2>/dev/null)" ]; then
  RUNS_TAR="$BACKUP_DIR/daily/scraper-runs-$TODAY.tar.gz"
  tar -czf "$RUNS_TAR" -C "$DATA_DIR" scraper-runs
  log "  ✓ scraper-runs: $(basename "$RUNS_TAR") ($(du -h "$RUNS_TAR" | cut -f1))"
fi

# 3b. Email attachments (PDF ponude, slike)
if [ -d "$DATA_DIR/attachments" ] && [ -n "$(ls -A "$DATA_DIR/attachments" 2>/dev/null)" ]; then
  ATT_TAR="$BACKUP_DIR/daily/attachments-$TODAY.tar.gz"
  tar -czf "$ATT_TAR" -C "$DATA_DIR" attachments
  log "  ✓ attachments: $(basename "$ATT_TAR") ($(du -h "$ATT_TAR" | cut -f1))"
fi

# 4. Rotacija — briše bekape starije od X dana
find "$BACKUP_DIR/daily" -type f -name "*.gz" -mtime "+$KEEP_DAILY" -delete -print | sed 's/^/  - /'
find "$BACKUP_DIR/weekly" -type f -name "*.gz" -mtime "+$((KEEP_WEEKLY * 7))" -delete -print | sed 's/^/  - /'

log "✓ Backup gotov. Čuva se: $KEEP_DAILY dnevnih + $KEEP_WEEKLY nedeljnih."

# 5. Opcioni remote sync (rsync) — otkomentariši i podesi DEST
# rsync -az --delete "$BACKUP_DIR/" "user@backup-server:/backups/outreach/"