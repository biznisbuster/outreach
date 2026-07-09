# ============================================================================
# Outreach scraper — optimizovani Dockerfile
# ----------------------------------------------------------------------------
# Ključne optimizacije:
#   1. Bazni image je Playwright Python — chromium + sistemski deps već
#      prisutni, nema `playwright install chromium` (štedi ~150 MB + ~60-90s).
#   2. BuildKit cache mount za /root/.cache/uv — Python wheel-ovi se keširaju
#      između build-ova.
#   3. COPY pyproject.toml + uv.lock odvojeno od app/ — izmena koda ne
#      ponovo instalira deps.
# ============================================================================

# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy AS deps

WORKDIR /app

# Cache mount za uv — wheel-ovi se čuvaju između buildova
RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    --mount=type=cache,target=/root/.cache/pip,sharing=locked \
    pip install --no-cache-dir uv && \
    uv pip install --system .

# Sad kad su deps keširani, dodaj kod (retko se menja pyproject)
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy AS runtime

WORKDIR /app

# Preuzmi instalirane pakete iz deps stage
COPY --from=deps /usr/local/lib/python3.12/site-packages /usr/local/lib/python3.12/site-packages
COPY --from=deps /usr/local/bin /usr/local/bin

# Samo kod — bez pyproject.toml, bez lock-a, bez README
COPY app ./app

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8001 \
    # Playwright bvari se setuju u base image-u; ovaj env samo garantuje path
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8001

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]