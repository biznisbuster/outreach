FROM mcr.microsoft.com/playwright/python:v1.61.0-jammy

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install uv (faster, lockfile-aware)
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates \
    && curl -LsSf https://astral.sh/uv/install.sh | sh \
    && mv /root/.local/bin/uv /usr/local/bin/uv \
    && apt-get purge -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

# Copy project files
# README.md je obavezan jer pyproject.toml ima `readme = "README.md"`
COPY pyproject.toml uv.lock README.md ./
COPY src ./src
COPY scripts ./scripts

# Install project (includes FastAPI/uvicorn since we added them to deps)
RUN uv sync --frozen --no-dev

# Persistent run artefacts (CSV + per-job logs)
RUN mkdir -p /data/scraper-runs
VOLUME ["/data/scraper-runs"]

ENV PATH="/app/.venv/bin:$PATH" \
    RUNS_DIR=/data/scraper-runs \
    PORT=8002 \
    HOST=0.0.0.0

EXPOSE 8002

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD python -c "import urllib.request,sys; urllib.request.urlopen('http://localhost:8002/health', timeout=3); sys.exit(0)" || exit 1

CMD ["python", "-m", "uvicorn", "maps_cold_calling.api:app", "--host", "0.0.0.0", "--port", "8002"]