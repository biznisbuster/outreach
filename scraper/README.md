# Outreach site audit (`scraper/audit`)

A multi-criteria 0-100 site rating with full SEO / performance / content /
security / mobile / accessibility / authority breakdown. Designed to help a
salesperson decide **whether to pitch services** to a lead.

## TL;DR

```
POST /audit/{lead_id}                # run audit on the lead's latest scrape
GET  /audit/{lead_id}/latest         # fetch the most recent stored audit
GET  /audit/by-id/{audit_id}         # fetch a specific audit
```

Every audit returns:

```jsonc
{
  "audit_id": 42,
  "lead_id": 13,
  "domain": "example.com",
  "scrape_id": 6,
  "scrape_meta": { "pages_discovered": 12, "pages_scraped": 12 },
  "overall_rank": 67,                  // 0-100
  "verdict": "average",                // critical|below_avg|average|good|excellent
  "verdict_label": "🟡 Average",
  "pitch_advice": "Worth pitching — room for improvement.",
  "top_issues": [ "..." ],
  "categories": {
    "seo":         { "score": 75, "weight": 0.25, "weighted": 18.75, "issues": [...] },
    "performance": { "score": 50, "weight": 0.20, "weighted": 10.00, "issues": [...] },
    "content":     { "score": 80, "weight": 0.20, "weighted": 16.00, "issues": [...] },
    "security":    { "score": 90, "weight": 0.10, "weighted":  9.00, "issues": [...] },
    "mobile_a11y": { "score": 78, "weight": 0.10, "weighted":  7.80, "issues": [...] },
    "tech_modern": { "score": 70, "weight": 0.05, "weighted":  3.50, "issues": [...] },
    "authority":   { "score": 45, "weight": 0.10, "weighted":  4.50, "issues": [...] }
  },
  "metrics": { /* detailed raw measurements, per category */ },
  "pages":   [ /* per-page score + issues */ ],
  "duration_ms": 4200,
  "created_at": "2026-07-09T13:30:00Z"
}
```

## Verdict bands (matches your "67 average, 20 bad, 86 good" mental model)

| Overall | Verdict      | Label                | Action                                |
|--------:|--------------|----------------------|---------------------------------------|
| 0–30    | `critical`   | 🔴 Critical          | Aggressive pitch — broken / unfinished |
| 31–55   | `below_avg`  | 🟠 Below average     | Strong pitch — many gaps              |
| 56–70   | `average`    | 🟡 Average           | Worth pitching                        |
| 71–85   | `good`       | 🟢 Good              | Cautious — already competent          |
| 86–100  | `excellent`  | 🟢 Excellent         | Skip — likely to reject               |

## Categories (and what each one measures)

| Category      | Weight | What it checks |
|---------------|-------:|----------------|
| **SEO**       | 25 %   | per-page title / meta-description / H1 coverage; canonical URL; meta robots; sitemap; JSON-LD / OpenGraph / Twitter / hreflang |
| **Performance** | 20 % | TTFB median; page-weight median; render-blocking scripts+styles in `<head>`; gzip/brotli compression; HTTP/2 (via `Alt-Svc`); resource hints (`preload`, `preconnect`, `dns-prefetch`, `prefetch`); FCP & LCP p75 when available |
| **Content**    | 20 %  | average word count; thin-content pages ratio; Flesch Reading Ease on homepage; heading hierarchy (h1→h2→h3 chain, no skipped levels); duplicate-content clusters via shingle-Jaccard on (h1 + first 200 chars body) |
| **Security**   | 10 %  | HTTPS-only enforcement; HSTS; CSP; X-Frame-Options (or `frame-ancestors`); X-Content-Type-Options; Referrer-Policy; Permissions-Policy |
| **Mobile / A11y** | 10 % | viewport meta; responsive images (srcset/sizes/picture); HTML `lang`; alt-text coverage; form-label coverage; accessible-text on links/buttons; skip-to-content link |
| **Tech / Modern** | 5 % | modern JS framework signals; modern hosting; HTTP/2; absence of leaked `X-Powered-By` |
| **Authority**  | 10 %  | Tranco popularity rank (logarithmic); Open PageRank (optional, requires `OPENPAGERANK_API_KEY`); social profiles (Facebook, Instagram, X, LinkedIn, YouTube, TikTok, Pinterest); contact info (email, phone, address) |

The category weights sum to **1.00**. `overall_rank = sum(score × weight)`,
rounded to the nearest integer.

## Storage

The audit persists two new tables (created via the `raw.exec(...)` belt-and-suspenders block in `gui-astro/src/lib/db/index.ts`, and declared in `gui-astro/src/lib/db/schema.ts`):

```
site_audits         (id, lead_id, scrape_id, domain, overall_rank, verdict,
                     verdict_label, pitch_advice, top_issues_json,
                     category_scores_json, metrics_json, duration_ms, created_at)
site_audit_metrics  (id, audit_id, category, score, weight, weighted,
                     issues_json, raw_json)
```

To run the migration through Drizzle as well (so the AST types in Astro match the live DB):

```sh
cd gui-astro && npm run db:push
```

The Python scraper ships raw INSERTs only — Drizzle declares the schema.

## Environment variables (audit-specific)

| Variable                       | Default                    | What it does |
|--------------------------------|----------------------------|--------------|
| `MAX_AUDIT_PAGES`              | `25`                       | Page count cap per audit (matches stored URLs in latest scrape) |
| `AUDIT_DELAY_SEC`              | `0.4`                      | Sleep between page re-fetches |
| `OPENPAGERANK_API_KEY`         | (none)                     | If unset, the Open PageRank portion is skipped (and noted in `traffic.provider_notes`) |
| `TRANCO_CACHE_DIR`             | `data/tranco_cache`        | Cache dir for Tranco JSON files (one per domain, 7-day TTL) |
| `OPENPAGERANK_CACHE_DIR`       | `data/openpagerank_cache`  | Same shape for Open PageRank (24-hour TTL) |
| `TRANCO_TTL_SEC`               | `604800`                   | Override Tranco cache TTL |
| `OPENPAGERANK_TTL_SEC`         | `86400`                    | Override OPR cache TTL |

Visitor counts are intentionally absent (no free provider). If a user later
sets up SimilarWeb, swap the implementation of `traffic_module.traffic_signals`
in `app/audit/traffic.py` — no other code changes needed.

## How it works

```
POST /audit/{lead_id}
  │
  ├─→ db.get_lead(lead_id)              → raises if no website
  ├─→ db.get_latest_successful_scrape()  → raises if no scrape yet
  ├─→ db.get_scrape_page_urls(scrape_id)
  ├─→ audit.aggregate.fetch_raw_pages(urls)
  ├─→ audit.aggregate.enrich_pages_with_extra(raw_pages)
  ├─→ traffic.traffic_signals(domain)
  ├─→ audit.aggregate.aggregate(...)     → runs every sub-audit
  ├─→ audit.site_rank.compute_overall(...)  → weighted sum + verdict
  ├─→ db.create_audit(report)           → site_audits row + 7 metrics rows
  └─→ return JSON
```

Each sub-audit is a separate module with its own score + raw + issues list. They
are all pure functions of the page data, so the audit is reproducible and the
individual scores are easy to defend when talking to a prospect.

## Files

```
scraper/app/audit/
├── __init__.py
├── accessibility.py    ← alt text, lang, labels, ARIA, skip link, accessible text
├── aggregate.py        ← re-fetch + enrich + run all sub-audits + assemble JSON
├── content.py          ← Flesch, thin/duplicate detection, heading hierarchy
├── mobile.py           ← viewport, responsive images, font sizes, fixed widths
├── onpage.py           ← contact info, social profiles, analytics, chat widgets
├── performance.py      ← TTFB, page weight, render-blocking, compression, HTTP/2
├── runner.py           ← entry point: load scrape → audit → persist → return
├── security.py         ← HSTS, CSP, X-Frame-Options, X-Content-Type-Options, ...
├── site_rank.py        ← weighted-sum scoring + verdict thresholds (pure)
├── structured.py       ← canonical, OG, Twitter, hreflang, JSON-LD
├── tech_stack.py       ← CMS / framework / hosting detection
└── traffic.py          ← Tranco + Open PageRank (free, optional API key)
```
