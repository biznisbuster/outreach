#!/usr/bin/env bash
# ============================================================================
# build.sh — brzi Docker build za Outreach
# ----------------------------------------------------------------------------
# Koristi buildx + persistent cache u named volume-u. Build keš preživljava
# `docker system prune` i između potpuno novih image-a.
#
# Prvo pokretanje (jednom):
#   docker buildx create --name outreach --driver docker-container --use
#
# Svaki put:
#   ./deploy/build.sh                  # svi servisi, keširano
#   ./deploy/build.sh scraper-leads    # samo jedan servis
# ============================================================================
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# Osiguraj da buildx postoji
if ! docker buildx inspect outreach >/dev/null 2>&1; then
    echo "→ Kreiram buildx builder 'outreach'..."
    docker buildx create --name outreach --driver docker-container --use
else
    docker buildx use outreach
fi

# Perzistentni cache (local folder, preživljava container recreate)
# type=volume ne radi na buildx v0.30, koristimo type=local
export BUILDX_CACHE_DIR="${BUILDX_CACHE_DIR:-$HOME/.docker/buildx-cache}"

# Koji servis? (default: sva tri)
SERVICES="${@:-gui-astro scraper scraper-leads}"

# Compose komanda
COMPOSE_FILE="docker-compose.vps.yml"

build_one() {
    local svc="$1"
    local ctx=""

    case "$svc" in
        gui-astro)     ctx="./gui-astro" ;;
        scraper)       ctx="./scraper" ;;
        scraper-leads) ctx="./scraper-leads" ;;
        *) echo "✗ Nepoznat servis: $svc"; return 1 ;;
    esac

    echo ""
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "  Building $svc  ($ctx)"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    local dockerfile="$ctx/Dockerfile"
    local cache_dir="$BUILDX_CACHE_DIR/$svc"

    # type=local kešira u folder na hostu. Buildx 0.30 ima bag sa type=volume.
    mkdir -p "$cache_dir"

    docker buildx build \
        --file "$dockerfile" \
        --tag "outreach-$svc:latest" \
        --cache-from "type=local,src=$cache_dir" \
        --cache-to "type=local,dest=$cache_dir,mode=max" \
        --load \
        "$ctx"
}

for svc in $SERVICES; do
    build_one "$svc"
done

# Ako si u produkciji, pokreni compose da osveži kontejnere
if [ -f .env ] && grep -q "OUTREACH_DATA_DIR" .env; then
    echo ""
    echo "→ Osvežavam kontejnere..."
    docker compose -f "$COMPOSE_FILE" --env-file .env up -d
else
    echo ""
    echo "ℹ .env nema OUTREACH_DATA_DIR — samo sam izgradio image-ove."
    echo "  Za produkciju: docker compose -f $COMPOSE_FILE --env-file .env up -d"
fi