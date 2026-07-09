# ---- build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# native deps za better-sqlite3 (prebuild koristi libc, radi i bez ovoga,
# ali ostavljamo za slučaj rebuild-a od izvornog koda)
RUN apk add --no-cache python3 make g++ build-base

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runner ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOST=0.0.0.0

# samo runtime native deps (prebuild bazi već uključuje native binding)
RUN apk add --no-cache libstdc++

COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/.env.example ./.env.example

EXPOSE 3000
CMD ["npm", "start"]
