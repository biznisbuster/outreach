# ============================================================================
# Outreach GUI (Astro v7) — Dockerfile (Debian-based)
# ----------------------------------------------------------------------------
# Prebačeno sa Alpine na bookworm-slim jer Alpine nema fcntl64 simbol koji
# better-sqlite3 native binding zahteva (gcompat ne pomaže).
#
# Optimizacije:
#   1. COPY package*.json PRVI → npm ci (deps) je u zasebnom layer-u.
#   2. BuildKit cache mount za /root/.npm — npm kešira između buildova.
#   3. .dockerignore isključuje nepotrebne fajlove iz build konteksta.
# ============================================================================

# syntax=docker/dockerfile:1.7

# ---- build stage ----
# Node 22 LTS (Astro 7+ zahteva >=22.12). bookworm-slim = Debian 12, libc6,
# ima libstdc++ out-of-the-box — radi sa better-sqlite3 prebuild.
FROM node:22-bookworm-slim AS builder

WORKDIR /app

# Native build deps za better-sqlite3 (mada prebuild ne zahteva, ostavlja
# za slučaj rebuild-a od source-a).
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json* ./

RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --prefer-offline

COPY . .

RUN rm -f .env.example AGENTS.md SESSION-SUMMARY.md 2>/dev/null || true

RUN npm run build

# ---- runner stage ----
FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Runtime libs za better-sqlite3 + wget (za Docker healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libstdc++6 wget \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "start"]