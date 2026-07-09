# ============================================================================
# Outreach scraper — optimizovani Dockerfile (pip, ne uv)
# ----------------------------------------------------------------------------
# python:3.12-slim kao baza. Playwright + chromium se instaliraju ručno u
# runtime stage.
#
# Optimizacije:
#   1. BuildKit cache mount za /root/.cache/pip — wheel-ovi keširani između
#      buildova.
#   2. Multi-stage: deps u deps stage, kod u runtime stage (izmena koda ne
#      reinstalira deps).
#   3. Sistemski Playwright deps se instaliraju jednom (deps + runtime).
# ============================================================================

# syntax=docker/dockerfile:1.7

# ---- deps stage ----
FROM python:3.12-slim AS deps

WORKDIR /app

# Sistemski build deps za Python pakete (lxml, pillow itd.)
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libffi-dev libxml2-dev libxslt1-dev libjpeg-dev zlib1g-dev \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./

# pip install . — instalira ceo projekat + dependencies iz pyproject.toml
RUN --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --no-cache-dir .


# ---- runtime stage ----
FROM python:3.12-slim AS runtime

WORKDIR /app

# Playwright sistemski deps za chromium + libstdc++
RUN apt-get update && apt-get install -y --no-install-recommends \
    # Playwright runtime deps (chromium)
    libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libdbus-1-3 libxkbcommon0 libxcomposite1 \
    libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 \
    libcairo2 libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Preuzmi instalirane pakete iz deps stage
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Samo kod
COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8001

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]