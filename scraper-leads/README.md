# maps-cold-calling — integration reference

**Two CLI tools for cold-outreach lead generation**, designed to be wired into a webapp:

1. **`maps-cold-calling`** — scrape Google Maps for businesses matching `(category, city, country)`.
2. **`maps-cold-calling-audit`** — take the resulting leads CSV and audit each business's website (SEO, content, design, blog, tech stack, age, lead-quality verdict).

Both are async, Python ≥ 3.12, use `uv` for deps, headless Chromium via Playwright, and ship with deterministic output schemas. The README below is structured as a contract for an integrating webapp — every section is what an AI agent needs to consume the tool correctly.

---

## Table of contents

1. [Quick start](#1-quick-start)
2. [Install](#2-install)
   - 2.1 [Arch Linux (development)](#21-arch-linux)
   - 2.2 [Debian / Ubuntu VPS (production)](#22-debian--ubuntu-vps)
   - 2.3 [Other Linux / Alpine / Docker](#23-other-linux--alpine--docker)
3. [CLI reference — maps-cold-calling (scraper)](#3-cli-reference--maps-cold-calling-scraper)
4. [CLI reference — maps-cold-calling-audit](#4-cli-reference--maps-cold-calling-audit)
5. [Output schemas](#5-output-schemas)
   - 5.1 [Scraper CSV columns](#51-scraper-csv-columns)
   - 5.2 [Audit CSV columns (appended)](#52-audit-csv-columns-appended)
6. [Exit codes](#6-exit-codes)
7. [Environment variables](#7-environment-variables)
8. [Webapp integration patterns](#8-webapp-integration-patterns)
   - 8.1 [Subprocess (recommended for v1)](#81-subprocess-recommended-for-v1)
   - 8.2 [In-process async (FastAPI)](#82-in-process-async-fastapi)
   - 8.3 [Background queue (Celery / Arq)](#83-background-queue-celery--arq)
9. [Sample REST API](#9-sample-rest-api)
10. [Performance, rate limits, and stealth](#10-performance-rate-limits-and-stealth)
11. [Limitations and known issues](#11-limitations-and-known-issues)
12. [Testing](#12-testing)
13. [Extending the scraper](#13-extending-the-scraper)
14. [Project layout](#14-project-layout)
15. [Resume protocol for AI agents](#15-resume-protocol-for-ai-agents)

---

## 1. Quick start

```bash
# install
uv sync
uv run playwright install chromium

# 1. scrape 20 hair salons in Beograd, plus try to extract an email from
#   each business's website
uv run python -m maps_cold_calling \
  --category "frizerski salon" \
  --city "Beograd" \
  --country RS \
  --extract-emails \
  --max-results 20 \
  --output leads.csv

# 2. audit every lead's website → score 0–100, CALL/MAYBE/SKIP verdict
uv run python -m maps_cold_calling.audit \
  --input leads.csv \
  --output leads-audited.csv \
  --concurrency 6

# 3. sort leads-audited.csv by site_verdict (CALL first), then site_score desc
```

The audit is non-blocking-friendly: `CALL` rows are your best pitch targets, `MAYBE` need a personalised pitch, `SKIP` already-have-good-sites — don't waste the call.

---

## 2. Install

### 2.1 Arch Linux

```bash
sudo pacman -S --needed chromium nss libxcomposite libxdamage \
  libxrandr libxkbcommon alsa-lib pango cairo gtk4

uv sync
uv run playwright install chromium
```

### 2.2 Debian / Ubuntu VPS

```bash
sudo apt-get update && sudo apt-get install -y \
  libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
  libxkbcommon0 libxcomposite1 libxdamage1 libxrandr2 libgbm1 \
  libpango-1.0-0 libcairo2 libasound2t64 libxshmfence1 \
  fonts-liberation fonts-noto-color-emoji

# project
git clone <repo> maps-cold-calling
cd maps-cold-calling
uv sync
uv run playwright install chromium

# smoke
uv run python scripts/smoke_browser.py     # boots Maps, asserts no crash
uv run python scripts/smoke_audit.py       # audits 5 known-good sites
```

### 2.3 Other Linux / Alpine / Docker

Playwright publishes a complete Dockerfile at <https://playwright.dev/python/docs/browsers#docker>. Use `mcr.microsoft.com/playwright/python:v1.61.0-jammy` as the base and add your project on top. Alpine is **not** officially supported by Playwright; use Debian-slim.

---

## 3. CLI reference — `maps-cold-calling` (scraper)

```
python -m maps_cold_calling
  --category TEXT       # required
  --city TEXT           # required
  --country TEXT        # ISO 3166-1 alpha-2; default RS
  --language TEXT       # BCP-47 hint; default sr
  --max-results INT     # cap on number of businesses; no cap by default
  --extract-emails      # opt-in: visit each business website to find an email
  --stealth {off,lite,standard,aggressive}   # default lite
  --proxy URL           # http://user:pass@host:port  OR  MAPS_PROXY env
  --headless            # default — implicit; --headed to show browser
  --output PATH         # output file; default ./leads.csv
  --format {csv,json,sqlite}   # default csv
  --on-captcha {stop,skip}    # default skip
  --dry-run             # cap to 3 results, no output file written
  --resume PATH         # JSONL checkpoint to dedupe across runs
  -v / --verbose        # DEBUG logging
  -q / --quiet          # WARNING logging only
```

**Stealth tiers (current behavior):**

| Tier | What it does today |
|---|---|
| `off` | No `playwright-stealth` plugin. Locale/tz/UA still set. |
| `lite` (default) | `playwright-stealth` plugin + locale/tz/UA randomisation. Tested on Kruševac/Beograd (10s of businesses/run). |
| `standard` | Currently identical to `lite`. Will add char-by-char typing + scroll jitter. |
| `aggressive` | Currently identical to `lite`. Will add per-request proxy rotation + viewport randomisation. |

**`--resume` semantics:** load the JSONL at the given path, skip any `google_place_id` already seen, append each new business to the file. The same JSONL doubles as a checkpoint (kill-and-resume safe) and as a dedup key across runs.

**Pagination model:** scrapes all cards the search feed returns, capped by `--max-results`. Stops scrolling automatically when no new cards appear for 8 seconds (Google's "end of list" marker is unreliable, so we use idle-timeout instead).

**Captcha behavior:** `utils/captcha.py` detects `<iframe src*="recaptcha">`, "unusual traffic" body text, and `/sorry/` URLs. Detection only — no solving (by design). On detect: `--on-captcha stop` exits with code 3, `--on-captcha skip` warns and exits 0.

---

## 4. CLI reference — `maps-cold-calling-audit`

```
python -m maps_cold_calling.audit
  --input PATH         # required — CSV from maps-cold-calling
  --output PATH        # required — augmented CSV written here
  --concurrency INT    # max parallel site audits; default 4
  --per-host INT       # max parallel requests per host; default 2
  --skip-age           # skip WHOIS/RDAP (roughly halves time, loses domain age)
  -v / --verbose
  -q / --quiet
```

**Audit pipeline per site:**

1. Fetch homepage (HEAD probe + GET fallback).
2. Parse SEO (`<title>`, `<meta description>`, `<h1>`, `<h2>` count, canonical, `lang`, `og:*`).
3. Count images + alt-text coverage, internal/external link counts.
4. Detect tech stack (WordPress / Wix / Squarespace / Shopify / Next.js / Nuxt / React / Vue / Bootstrap / Tailwind / jQuery / Google Analytics / GTM / Cloudflare / reCAPTCHA / FB pixel).
5. Probe `/robots.txt` + `/sitemap.xml` for sitemap entries (page-count estimate).
6. Probe ~10 blog paths (`/blog`, `/vesti`, `/novosti`, `/clanci`, …).
7. **Domain age lookup:** RDAP via `https://rdap.org/domain/<apex>` first; raw WHOIS over TCP port 43 as fallback (handles `.rs` via `whois.rnids.rs`, any TLD via `whois.iana.org` resolution).
8. Score 0–100 across 7 categories.
9. Return A–F grade + `CALL` / `MAYBE` / `SKIP` verdict + pros/cons list.

**Verdict semantics:**

| Verdict | Meaning |
|---|---|
| `CALL` | Site has visible gaps AND is reachable AND (has a blog OR is on a CMS the business could edit OR is ≤ 5 years old). Strongly recommended pitch. |
| `MAYBE` | Site is mid-quality. Needs a personalised pitch. |
| `SKIP` | Site is already ≥ 80/100 (no angle), unreachable (HTTP ≥ 400 or connection error), or has no title/h1 to even pitch against. |

**Composite score weights (total 100):**
SEO 30 · Mobile 15 · Security 10 · Content 15 · Completeness 15 · Modernity 10 · Performance 5.
Full breakdown in [`src/maps_cold_calling/audit/scoring.py`](src/maps_cold_calling/audit/scoring.py).

**Status values per row:**
- `ok` — full audit (homepage fetched, body parsed, age retrieved).
- `partial` — homepage blocked (HTTP ≥ 400) OR transport error, but age/registrar may still be present.
- `failed` — transport-level failure (DNS, connection refused). Audit data is empty.
- `skipped` — input row had no URL column, empty URL, or the URL is a social-network profile (filtered).

---

## 5. Output schemas

### 5.1 Scraper CSV columns

Written in this **exact order**. UTF-8, `QUOTE_MINIMAL`, `\n` line terminator.

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `name` | str | NO | Validated non-empty by `Business.__post_init__`. |
| `address` | str | yes | Google-rendered, Cyrillic/Latin auto. |
| `city` | str | yes | from `--city` flag |
| `country` | str | yes | from `--country` flag (uppercased) |
| `phone_e164` | str | yes | E.164 via `phonenumbers`. Example: `+381641727770` |
| `phone_raw` | str | yes | Original digits-only, no plus. |
| `website` | str | yes | Trimmed. Empty for businesses without one. |
| `email` | str | yes | Only populated if `--extract-emails` and extraction succeeded. |
| `category` | str | yes | Free-text category as rendered by Maps. Often empty for small businesses. |
| `rating` | float | yes | 0.0–5.0. Comma-as-decimal tolerated in source (`4,7` → `4.7`). |
| `reviews_count` | int | yes | Integer. Empty if Maps doesn't expose. |
| `latitude` | float | yes | Extracted from Maps URL hash. |
| `longitude` | float | yes | Same. |
| `google_place_id` | str | yes | The `ChIJ...` token. Stable identifier for dedupe. |
| `google_maps_url` | str | yes | The final URL after redirect (canonical detail-page URL). |
| `hours_json` | str | yes | Currently always empty; will become a JSON-encoded dict when Phase 5.4 lands. |
| `source` | str | NO | Always `maps` for this CLI. |
| `scraped_at` | str | NO | UTC ISO-8601 with seconds, set on construction. |

### 5.2 Audit CSV columns (appended)

For every input row, the audit adds these 40 columns to the **end** of the CSV. Original columns are preserved in their original order.

| Column | Type | Description |
|---|---|---|
| `audit_status` | `ok` \| `partial` \| `failed` \| `skipped` | Row-level outcome |
| `audit_error` | string | Human-readable error if not `ok` |
| `audit_run_at` | string | UTC ISO-8601 timestamp |
| `site_url` | string | Final URL after redirects |
| `site_http_status` | int | Final HTTP status (200, 404, 403, …) |
| `site_response_ms` | int | Time to first byte |
| `site_https` | bool | Whether the **final** URL is https |
| `site_redirects` | int | Redirect chain length |
| `site_page_bytes` | int | Response body size |
| `site_gzip` | bool | gzip OR brotli Content-Encoding present |
| `site_title` | string | `<title>` cleaned of whitespace |
| `site_meta_description` | string | `<meta name="description">` |
| `site_h1` | string | First `<h1>` |
| `site_h2_count` | int | Count of `<h2>` |
| `site_canonical` | string | `<link rel="canonical">` resolved to absolute URL |
| `site_lang` | string | `<html lang>` |
| `site_og_title` | string | `<meta property="og:title">` |
| `site_og_description` | string | `<meta property="og:description">` |
| `site_word_count` | int | Total visible body words |
| `site_image_count` | int | `<img>` count |
| `site_image_alt_coverage` | float | 0.0–1.0 ratio of images with non-empty `alt` |
| `site_has_robots` | bool | `/robots.txt` returns 2xx |
| `site_has_sitemap` | bool | `/sitemap.xml` (or common variants) returns 2xx |
| `site_internal_links` | int | Same-origin `<a href>` count |
| `site_external_links` | int | Off-origin `<a href>` count |
| `site_estimated_pages` | int | Sitemap entry count, fallback to internal link count |
| `site_has_blog` | bool | One of: blog-path probe hit OR `/blog`/`/vesti`/etc anchor in homepage HTML |
| `site_blog_url` | string | First matching blog URL (absolute) |
| `site_mobile_viewport` | bool | `<meta name="viewport">` present |
| `site_tech_stack` | JSON list | E.g. `["wordpress", "jquery", "gtm"]` |
| `site_domain` | string | Apex of `site_url` (e.g. `www.foo.rs` → `foo.rs`) |
| `site_domain_created` | string | ISO date `YYYY-MM-DD` |
| `site_domain_age_years` | float | Years since `site_domain_created` (1 decimal) |
| `site_domain_registrar` | string | E.g. `RNIDS`, `MarkMonitor Inc.`, `CRI DOMAINS` |
| `site_score` | int | 0–100 composite |
| `site_grade` | `A` \| `B` \| `C` \| `D` \| `F` | From score thresholds (85/70/55/40) |
| `site_verdict` | `CALL` \| `MAYBE` \| `SKIP` | See §4 |
| `site_pros` | JSON list | One-line observations (HTTPS on, has blog, …) |
| `site_cons` | JSON list | One-line observations (no meta description, …) |
| `site_summary` | string | One-line TL;DR, e.g. `"My Salon" — C (60/100) → CALL; 13.0y old; wordpress,jquery` |

JSON-encoded list/dict columns are stored as JSON strings (`json.dumps(ensure_ascii=False)`). Decode with `json.loads(...)` in your webapp.

---

## 6. Exit codes

### `maps-cold-calling`

| Code | Meaning |
|---|---|
| `0` | Success. Captcha (`--on-captcha skip`) also exits 0 with a warning. |
| `2` | Empty result (search returned no cards). Probably wrong query or rate-limited. |
| `3` | Captcha detected AND `--on-captcha stop`. |
| `130` | User-initiated (SIGINT). |

### `maps-cold-calling-audit`

| Code | Meaning |
|---|---|
| `0` | Always. Audit is best-effort: per-row failures are recorded in `audit_status`, never crash the run. |

---

## 7. Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `MAPS_PROXY` | Proxy URL (used if `--proxy` is not given). Format: `http://user:pass@host:port` or `socks5://host:port`. | unset |
| `PLAYWRIGHT_BROWSERS_PATH` | Override Playwright's browser install dir. | `~/.cache/ms-playwright/` |
| `PYTHONUNBUFFERED` | Set to `1` so logs stream when you pipe into a webapp. | unset |
| `LOG_LEVEL` | Optional override (`DEBUG`/`INFO`/`WARNING`) — `-v`/`-q` flags take precedence. | derived from flags |

---

## 8. Webapp integration patterns

Three viable patterns. Pick by latency, volume, and how you run your webapp.

### 8.1 Subprocess (recommended for v1)

Pros: zero coupling, scraper can't crash your webapp, easy to version (just `pip install` a different tag).
Cons: 1–5s subprocess startup overhead per call.

```python
# webapp.py — FastAPI example, full pattern
import csv
import json
import subprocess
import time
from pathlib import Path

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

from maps_cold_calling import __version__           # 0.1.0
from maps_cold_calling.audit.pipeline import run_audit
from maps_cold_calling.models import Business

app = FastAPI(title="maps-cold-calling webapp", version=__version__)

# Stable on-disk location for run artefacts.
RUNS = Path("/var/lib/scraper/runs")
RUNS.mkdir(parents=True, exist_ok=True)

REPO = Path("/opt/maps-cold-calling")              # where you cloned the project


class ScrapeRequest(BaseModel):
    category: str = Field(..., min_length=2)
    city: str = Field(..., min_length=1)
    country: str = "RS"
    language: str = "sr"
    max_results: int = Field(20, ge=1, le=500)
    extract_emails: bool = False
    resume_path: str | None = None                 # JSONL to dedupe against


class ScrapeResponse(BaseModel):
    run_id: str
    count: int
    skipped: int
    rows: list[dict]


def _scraper_cmd(req: ScrapeRequest, out_csv: Path, resume_jsonl: Path | None) -> list[str]:
    cmd = [
        "uv", "run", "python", "-m", "maps_cold_calling",
        "--category", req.category,
        "--city", req.city,
        "--country", req.country,
        "--language", req.language,
        "--max-results", str(req.max_results),
        "--output", str(out_csv),
    ]
    if req.extract_emails:
        cmd.append("--extract-emails")
    if req.resume_path or resume_jsonl is not None:
        cmd.extend(["--resume", str(resume_jsonl or req.resume_path)])
    if extract_emails_requested := req.extract_emails:        # noqa: F841 (silent)
        # On a fresh run with --extract-emails we want a fresh JSONL unless caller passes one.
        pass
    return cmd


@app.post("/scrape", response_model=ScrapeResponse)
def scrape(req: ScrapeRequest) -> ScrapeResponse:
    run_id = f"{int(time.time())}_{req.city.replace(' ', '_')}_{req.category.replace(' ', '_')}"
    out_csv = RUNS / f"{run_id}.csv"
    resume_jsonl = RUNS / f"{run_id}.jsonl"

    try:
        proc = subprocess.run(
            _scraper_cmd(req, out_csv, resume_jsonl if req.extract_emails else None),
            cwd=REPO,
            capture_output=True,
            text=True,
            timeout=900,                                    # 15-min hard cap
            env={**__import__("os").environ, "PYTHONUNBUFFERED": "1"},
        )
    except subprocess.TimeoutExpired:
        raise HTTPException(504, "scrape timed out after 15 minutes")

    if proc.returncode not in (0,):
        # Map exit codes to HTTP statuses
        if proc.returncode == 2:
            raise HTTPException(404, "no results — empty query or rate-limited")
        if proc.returncode == 3:
            raise HTTPException(429, "captcha triggered — back off and retry later")
        raise HTTPException(500, f"scraper exit {proc.returncode}: {proc.stderr[-1000:]}")

    with out_csv.open() as f:
        rows = list(csv.DictReader(f))
    return ScrapeResponse(
        run_id=run_id,
        count=len(rows),
        skipped=0,
        rows=rows,
    )


@app.post("/audit")
def audit(input_csv: str, output_csv: str | None = None, concurrency: int = 4) -> dict:
    """Run the site-audit pipeline on an existing leads CSV."""
    in_path = Path(input_csv)
    if not in_path.exists():
        raise HTTPException(404, "input csv not found")
    out_path = Path(output_csv or str(in_path).replace(".csv", "_audited.csv"))

    # run_audit is sync and runs asyncio internally.
    stats = run_audit(in_path, out_path, concurrency=concurrency, per_host_max=2)

    # Load back as JSON so the caller can render / sort.
    with out_path.open() as f:
        rows = list(csv.DictReader(f))
    return {"stats": stats, "output": str(out_path), "count": len(rows), "rows": rows}
```

### 8.2 In-process async (FastAPI)

Use this when your webapp is already on the same machine and uses asyncio.

```python
# in the same FastAPI handler:
import asyncio
from maps_cold_calling.config import RunConfig
from maps_cold_calling.runner import _run
from maps_cold_calling.export.csv_writer import CsvWriter

@app.post("/scrape-async")
async def scrape_async(req: ScrapeRequest):
    cfg = RunConfig(
        category=req.category, city=req.city, country=req.country,
        language=req.language,
        max_results=req.max_results,
        extract_emails=req.extract_emails,
        output_path=RUNS / f"{int(time.time())}.csv",
        output_format="csv", on_captcha="skip", headless=True,
        verbose=False, quiet=True,
        resume_path=None, stealth_tier="lite", source="maps",
        proxy=None, dry_run=False,
    )
    rc = await _run(cfg)               # 0 on success, 2 / 3 on hard failures
    if rc not in (0,):
        raise HTTPException(500, "scrape failed")
    # ... load CSV and return
```

Pros: no subprocess overhead, fast for short runs.
Cons: a Playwright crash will raise inside your event loop; one heavy scrape will starve your other endpoints. Mitigate by running scrapes on a dedicated worker thread (`asyncio.to_thread`).

### 8.3 Background queue (Celery / Arq)

For multi-user or paid SaaS use cases:

- Each task = one Playwright Chromium instance; bind 1 task per worker.
- Set `--concurrency 1` on the scraper (one search at a time per worker).
- Auto-scale workers = CPU count (Chromium is single-process heavy).
- Store each run's CSV on shared storage (S3, NFS), return a URL to the row JSON.

---

## 9. Sample REST API

A minimal but production-shaped surface an AI/webapp can implement on top:

```
POST /scrape
  body:  {"category": "...", "city": "...", "country": "RS", "max_results": 20, "extract_emails": false}
  200:   {"run_id": "1719858000_Beograd_frizerski", "count": 47, "rows": [...]}
  404:   {"detail": "no results — empty query or rate-limited"}
  429:   {"detail": "captcha triggered — back off and retry later"}
  504:   {"detail": "scrape timed out after 15 minutes"}

POST /audit
  body:  {"input_csv": "/var/lib/.../leads.csv", "concurrency": 4}
  200:   {"stats": {"audited": 22, "skipped": 25, ...}, "output": "...", "rows": [...]}

GET  /leads?run_id=...&verdict=CALL&min_score=50
  200:   {"rows": [...], "count": N}      # filter to CALL only, sorted by score desc
```

For pagination, prefer the per-row `google_place_id` as a stable cursor.

---

## 10. Performance, rate limits, and stealth

**Throughput on a single VPS (Hetzner CX22, no proxy):**

| Run | Places/min | Notes |
|---|---|---|
| Beograd `frizerski salon`, `--stealth lite` | ~6–10 | Each place takes 4–8s (homepage + redirects + email extraction). |
| Same, `--skip-age` and no `--extract-emails` | ~15–20 | Just homepage fetches. |
| Two consecutive Beograd runs | Often 0 on second | Google blocks the second. Wait 10–20 min. |

**Hard limits:**
- One Playwright Chromium per process. (Tabs within the same context share state — don't try to parallelise.)
- One Google session per process. Cookies, fingerprints, and rate limits are shared.
- WHOIS via TCP has no rate limit but is slow (~1–2s per query). Use `--skip-age` to skip.

**Stealth tiers today** (see §3 table). For multi-thousand-business runs, use `--proxy` with a residential proxy rotation and `--stealth aggressive` once that's implemented.

---

## 11. Limitations and known issues

- **No captcha solving.** Detection only. If you need solving, this tool is not for you.
- **No JavaScript rendering for the audit stage.** The audit uses raw `httpx` + `selectolax` — sites that render their main content via JS (React SPAs, Cloudflare bot challenges) will get a partial row. For 2026 most small-business sites are server-rendered or use static HTML, so this is rarely an issue.
- **Some businesses don't expose data**: Maps 2024 dropped `category`, `reviews_count`, and `website` rendering for many small businesses. These columns are simply empty.
- **Beograd "feed not found"** — open question. Sometimes big-city searches trigger captcha, sometimes return a "local pack" carousel. Workaround: wait 5–10 min, rerun; or run with `--headed` to see what Maps returns.
- **WHOIS coverage gaps** — RDAP works for most TLDs; TCP fallback is best-effort. Some `404`s on RDAP are real ("no RDAP for this TLD"). `.rs` works reliably (RNIDS).
- **One Chromium per VPS.** Run a single scrape at a time per machine. Concurrent Playwright instances on the same IP make Google suspicious fast.

---

## 12. Testing

```bash
uv run pytest           # 51 offline tests; no Playwright needed
uv run pytest -v        # per-test names
uv run pytest -k audit  # just the audit tests
```

Smoke scripts (need real network):

```bash
uv run python scripts/smoke_browser.py      # open Maps, assert title
uv run python scripts/smoke_audit.py        # 5 known-good sites
uv run python scripts/smoke_audit_age.py    # exercises WHOIS path
uv run python scripts/smoke_audit_csv.py    # end-to-end on examples/sample_leads.csv
```

All smokes must currently be run by hand; they're not in CI because they hit real network endpoints.

---

## 13. Extending the scraper

If you want to extend (a common addition: persist to a database, add a new source, or add new fields to the audit):

- **Add a new column to the audit**: edit `src/maps_cold_calling/audit/models.py::CSV_COLUMNS` and `SiteAudit`, then populate it in `site_audit.py::_audit_after_lock()`. The pipeline auto-writes any new columns; existing rows in old CSVs will get an empty value for the new column.
- **Persist rows to a DB instead of CSV**: subclass `Exporter` from `src/maps_cold_calling/export/exporter.py` — `add`, `add_many`, `close`. Wire it in `runner.py::_make_exporter`.
- **Add a new source** (e.g. `planplus.rs`): create `src/maps_cold_calling/sources/planplus.py` with `async def search_businesses(...) -> AsyncIterator[Business]`. The CLI already declares `--source {maps,planplus,both}` (Phase 6 is planned but not yet shipped).
- **Change the verdict logic**: edit `src/maps_cold_calling/audit/scoring.py::_verdict`. The 5-call test in `tests/test_audit_scoring.py::test_perfect_site_scores_high_and_is_skip` is the model.

---

## 14. Project layout

```
maps-cold-calling/
├── pyproject.toml                    # uv-managed Python project
├── README.md                         # you are here
├── AGENTS.md                         # AI-agent continuity rules
├── src/maps_cold_calling/            # main package
│   ├── cli.py                        # argparse + entry point
│   ├── __main__.py                   # python -m maps_cold_calling
│   ├── runner.py                     # async pipeline orchestrator
│   ├── config.py                     # RunConfig dataclass
│   ├── models.py                     # Business dataclass + CSV columns
│   ├── scraper/
│   │   ├── browser.py                # Playwright + stealth setup
│   │   ├── maps_search.py            # Maps search + smart scroll
│   │   ├── maps_detail.py            # Maps place-page extraction
│   │   └── email.py                  # mailto + regex + deobfuscation
│   ├── export/
│   │   ├── exporter.py               # Exporter Protocol
│   │   ├── csv_writer.py             # CsvWriter
│   │   └── json_writer.py            # JsonWriter
│   ├── storage/checkpoint.py         # JSONL append + ResumeReader
│   ├── utils/
│   │   ├── phone.py                  # phonenumbers → E.164
│   │   ├── selectors.py              # multi-candidate fallback lists
│   │   ├── retries.py                # tenacity exponential backoff
│   │   └── captcha.py                # captcha/ block detection
│   ├── sources/                      # placeholder for PlanPlus.rs (Phase 6)
│   └── audit/                        # ← the new module (Phase 8)
│       ├── cli.py                    # python -m maps_cold_calling.audit
│       ├── __main__.py
│       ├── pipeline.py               # CSV → CSV augmentation
│       ├── site_audit.py             # per-site orchestrator
│       ├── http_client.py            # polite async httpx
│       ├── seo.py                    # SEO extractor (selectolax)
│       ├── tech.py                   # tech-stack detection
│       ├── whois_age.py              # RDAP + TCP WHOIS
│       ├── crawl.py                  # robots / sitemap / blog
│       ├── scoring.py                # 0–100 + verdict
│       └── models.py                 # SiteAudit dataclass
├── tests/                            # 51 offline tests
├── scripts/                          # smoke scripts (network)
├── examples/
│   ├── sample_leads.csv              # example input
│   └── sample_leads_audited.csv      # example output (regenerable)
└── .agent_output/                    # AI-agent continuity
    ├── state/current.json
    ├── plans/current.md
    └── state/history/CHANGELOG.md
```

---

## 15. Resume protocol for AI agents

If you (an AI) are picking this project up after context loss:

1. Read `.agent_output/state/current.json` first — it has the exact phase/task pointer and last checkpoint description.
2. Read `.agent_output/plans/current.md` next — full plan with sub-task checkboxes.
3. Read the last 10–20 entries of `.agent_output/state/history/CHANGELOG.md` for recent activity.
4. Resume from `current.json.next_task` — do not start over.

If you make any meaningful change, **append a `## YYYY-MM-DD — short summary` entry to CHANGELOG.md**, update `state/current.json`, and flip the relevant `[ ]` → `[x]` in `plans/current.md`. The `<!-- HANDOFF -->` block at the bottom of `plans/current.md` captures the last session's exit state.

See `AGENTS.md` at the project root for the full set of conventions (no deletions, log everything, async throughout, no captcha solving, etc.).
