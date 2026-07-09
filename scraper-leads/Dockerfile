# ============================================================================
# Outreach scraper-leads — optimizovani Dockerfile
# ----------------------------------------------------------------------------
# Bazni image je Playwright Python — chromium, firefox, webkit + sistemski
# deps već prisutni. apt-get update je izbačen (samo curl je trebao za uv
# instalaciju, a uv možemo da preuzmemo bez curl-a).
# ============================================================================

# syntax=docker/dockerfile:1.7
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy AS deps

WORKDIR /app

# uv može da se preuzme wget-om (već je u ubuntu baznom image-u)
# cache mount čuva wheel-ove između buildova
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY scripts ./scripts

RUN --mount=type=cache,target=/root/.cache/uv,sharing=locked \
    --mount=type=cache,target=/root/.local/share/uv,sharing=locked \
    apt-get update && apt-get install -y --no-install-recommends wget && \
    wget -qO- https://astral.sh/uv/install.sh | sh && \
    mv /root/.local/bin/uv /usr/local/bin/uv && \
    uv sync --frozen --no-dev && \
    apt-get purge -y wget && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*


# ----------------------------------------------------------------------------
# Runtime stage — samo .venv + kod, ništa drugo
# ----------------------------------------------------------------------------
FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy AS runtime

WORKDIR /app

# Preuzmi .venv iz deps stage
COPY --from=deps --chown=root:root /app/.venv /app/.venv
COPY --from=deps /app/src ./src
COPY --from=deps /app/scripts ./scripts

# Persistent run artefacts (CSV + per-job logs) — bind mount iz compose-a
RUN mkdir -p /data/scraper-runs
VOLUME ["/data/scraper-runs"]

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    RUNS_DIR=/data/scraper-runs \
    PORT=8002 \
    HOST=0.0.0.0 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:8002/health', timeout=3); sys.exit(0)" || exit 1

CMD ["python", "-m", "uvicorn", "maps_cold_calling.api:app", "--host", "0.0.0.0", "--port", "8002"]