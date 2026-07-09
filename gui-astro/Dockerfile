# ============================================================================
# Outreach GUI (Astro v7) — optimizovani Dockerfile
# ----------------------------------------------------------------------------
# Ključne optimizacije:
#   1. COPY package*.json PRVI → npm ci (deps) je u zasebnom layer-u koji se
#      kešira. Izmena koda ne reinstalira node_modules.
#   2. BuildKit cache mount za /root/.npm — npm kešira između buildova.
#   3. .dockerignore + .dockerignore unutar gui-astro/ isključuju
#      migrations, README, agent fajlove iz build konteksta.
# ============================================================================

# syntax=docker/dockerfile:1.7

# ---- build stage ----
# Astro 7 zahteva Node >=22.12.0 — koristimo Node 22 LTS.
FROM node:22-alpine AS builder

WORKDIR /app

# Native deps za better-sqlite3 (prebuild koristi libc, ali ostavljamo
# za slučaj rebuild-a od izvornog koda)
RUN apk add --no-cache python3 make g++ build-base

# 1. Samo package fajlovi — kešira se kao layer
COPY package.json package-lock.json* ./

# 2. npm ci sa cache mount-om (sledeći build reuse-uje keširane tarball-ove)
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --no-audit --no-fund --prefer-offline

# 3. Tek sad kopiraj kod — izmene ovde ne poništavaju npm ci layer
COPY . .

# Trim .env.example i ostalo pre buildu da ne završi u dist/
RUN rm -f .env.example AGENTS.md SESSION-SUMMARY.md 2>/dev/null || true

RUN npm run build

# ---- runner stage ----
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0

# Runtime native lib za better-sqlite3 prebuild
RUN apk add --no-cache libstdc++

# Preuzmi samo ono što treba za runtime
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["npm", "start"]