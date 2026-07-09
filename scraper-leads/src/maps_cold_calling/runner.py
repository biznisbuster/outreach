"""End-to-end orchestrator.

Pipeline::

    CLI args → RunConfig
              ↓
    Exporter (csv | json) [based on --format]
              ↓
    browser_session (Playwright)
              ↓
    page = new_page()
              ↓
    search_urls = collect_initial_results(page, ...)
              ↓
    for url in search_urls (up to max_results, skip seen via --resume):
        business = extract_business(page, url)
        if --extract-emails and business.website:
            business.email = extract_email(business.website)
        exporter.add(business)
        checkpoint.append(business)            [if --resume was used]
              ↓
    close all the things
"""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from pathlib import Path
from typing import Any

import httpx

from maps_cold_calling.config import RunConfig
from maps_cold_calling.export.csv_writer import CsvWriter
from maps_cold_calling.export.exporter import Exporter
from maps_cold_calling.export.json_writer import JsonWriter
from maps_cold_calling.progress import (
    EVT_END,
    EVT_ERROR,
    EVT_PROGRESS,
    EVT_SKIP,
    EVT_START,
    NullEmitter,
    ProgressEmitter,
    ProgressEvent,
    STAGE_CAPTCHA,
    STAGE_CONTACT,
    STAGE_DETAIL,
    STAGE_DONE,
    STAGE_EMAIL,
    STAGE_EXPORT,
    STAGE_GOOGLE_FALLBACK,
    STAGE_SCREENSHOT,
    STAGE_SEARCH,
    STAGE_STARTUP,
)
from maps_cold_calling.scraper.browser import browser_session
from maps_cold_calling.scraper.contact import (
    enrich_from_website,
    google_fallback_for_website,
    pick_best_website,
)
from maps_cold_calling.scraper.email import extract_email
from maps_cold_calling.scraper.maps_detail import extract_business
from maps_cold_calling.scraper.maps_search import collect_initial_results
from maps_cold_calling.storage.checkpoint import JsonlCheckpoint, ResumeReader
from maps_cold_calling.utils.captcha import detect as detect_captcha

LOG = logging.getLogger(__name__)


def _make_exporter(cfg: RunConfig) -> Exporter:
    if cfg.output_format == "json":
        return JsonWriter(cfg.output_path)
    return CsvWriter(cfg.output_path)


def _screenshot_dir(cfg: RunConfig) -> Path:
    """Direktorijum za homepage screenshot-ove poslovanja.

    Nalazi se pored izlaznog fajla, npr. RUNS_DIR/<job>/screenshots/.
    """
    p = cfg.output_path.parent / "screenshots"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _safe_slug(name: str) -> str:
    """Pretvori ime u slug za ime fajla."""
    import re as _re
    s = _re.sub(r"[^a-zA-Z0-9._-]+", "-", name).strip("-").lower()
    return (s or "x")[:60] or "x"


def _to_run_config(args: argparse.Namespace) -> RunConfig:
    # Ako je prosleđen --query, koristi se kao category a city ostaje prazan.
    # build_search_url ignoriše prazan city i pravi URL samo od category.
    if getattr(args, "query", None):
        category = args.query
        city = ""
    else:
        category = args.category or ""
        city = args.city or ""
    return RunConfig(
        category=category,
        city=city,
        country=(args.country or "RS").upper(),
        language=args.language,
        source=args.source,
        extract_emails=args.extract_emails,
        stealth_tier=args.stealth,
        proxy=args.proxy,
        headless=args.headless,
        output_path=Path(args.output),
        output_format=args.format,
        on_captcha=args.on_captcha,
        max_results=(args.max_results if args.max_results and args.max_results > 0 else None),
        dry_run=args.dry_run,
        resume_path=Path(args.resume) if args.resume else None,
        verbose=args.verbose,
        quiet=args.quiet,
        progress_stdout=getattr(args, "progress_stdout", False),
        progress_file=(Path(args.progress_file) if getattr(args, "progress_file", None) else None),
    )


def _configure_logging(cfg: RunConfig) -> None:
    if cfg.quiet:
        level = logging.WARNING
    elif cfg.verbose:
        level = logging.DEBUG
    else:
        level = logging.INFO
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        stream=sys.stderr,
    )


async def _run(cfg: RunConfig) -> int:
    """Async body of the pipeline."""

    # ── Progress emitter setup ──
    if cfg.on_progress or cfg.progress_stdout or cfg.progress_file:
        emitter: ProgressEmitter | NullEmitter = ProgressEmitter(
            callback=cfg.on_progress,
            file_path=cfg.progress_file,
            stdout=cfg.progress_stdout,
        )
    else:
        emitter = NullEmitter()

    emitter.emit(ProgressEvent(
        stage=STAGE_STARTUP,
        event=EVT_START,
        message=f"starting: category={cfg.category!r} city={cfg.city!r} country={cfg.country!r}",
        data={
            "category": cfg.category,
            "city": cfg.city,
            "country": cfg.country,
            "max_results": cfg.max_results,
            "extract_emails": cfg.extract_emails,
            "stealth_tier": cfg.stealth_tier,
        },
    ))

    if cfg.dry_run:
        original_max = cfg.max_results
        cfg.max_results = min(original_max or 3, 3)
        LOG.info("dry-run: capping to %d results", cfg.max_results)

    seen: set[str] = set()
    if cfg.resume_path is not None:
        reader = ResumeReader(cfg.resume_path)
        seen = reader.seen_place_ids
        if reader.businesses:
            LOG.info(
                "resume: %d businesses already scraped (will skip %d place_ids)",
                len(reader.businesses),
                len(seen),
            )

    extracted = 0
    skipped = 0
    emailed = 0
    exit_code = 0
    with _make_exporter(cfg) as out:
        ckpt: JsonlCheckpoint | None = None
        if cfg.resume_path is not None:
            ckpt = JsonlCheckpoint(cfg.resume_path)
        try:
            async with browser_session(
                stealth_tier=cfg.stealth_tier,
                proxy=cfg.proxy,
                headless=cfg.headless,
                language=cfg.language,
                country=cfg.country,
            ) as (_browser, context, _stealth):
                page = await context.new_page()
                emitter.emit(ProgressEvent(
                    stage=STAGE_SEARCH,
                    event=EVT_START,
                    message=f"searching Maps: {cfg.category!r} {cfg.city!r}",
                ))
                urls, feed_extras = await collect_initial_results(
                    page,
                    cfg.category,
                    cfg.city,
                    language=cfg.language,
                    country=cfg.country,
                    max_results=cfg.max_results,
                )
                emitter.emit(ProgressEvent(
                    stage=STAGE_SEARCH,
                    event=EVT_END,
                    count=len(urls),
                    total=len(urls),
                    message=f"found {len(urls)} place URLs",
                ))

                # Captcha / block check — Phase 3.4. Run BEFORE iterating
                # so we don't burn a place-attempt budget on a blocked run.
                if await detect_captcha(page):
                    emitter.emit(ProgressEvent(
                        stage=STAGE_CAPTCHA,
                        event=EVT_ERROR,
                        message="captcha/block detected after search",
                        data={"action": cfg.on_captcha},
                    ))
                    if cfg.on_captcha == "stop":
                        LOG.error("captcha/block detected — exiting (--on-captcha stop)")
                        exit_code = 3
                    else:
                        LOG.warning("captcha/block detected — skipping remaining places (--on-captcha skip)")
                        exit_code = 0
                    # Emit the DONE event below before returning.
                else:
                    if not urls:
                        emitter.emit(ProgressEvent(
                            stage=STAGE_DONE,
                            event=EVT_ERROR,
                            message="no results returned — empty search response or blocked",
                            data={"exit_code": 2},
                        ))
                        LOG.error("no results returned — empty search response or blocked")
                        return 2

                    LOG.info("runner: scraping %d places", len(urls))

                    async with httpx.AsyncClient(
                        timeout=httpx.Timeout(10.0, connect=5.0),
                        follow_redirects=True,
                        headers={
                            "User-Agent": (
                                "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
                                "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
                            )
                        },
                    ) as client:
                        for i, url in enumerate(urls, start=1):
                            feed_info = feed_extras.get(url, {})
                            emitter.emit(ProgressEvent(
                                stage=STAGE_DETAIL,
                                event=EVT_START,
                                count=extracted + skipped,
                                total=len(urls),
                                message=f"extracting {i}/{len(urls)}",
                                data={"index": i, "url": url},
                            ))
                            try:
                                biz = await extract_business(
                                    page,
                                    url,
                                    city=cfg.city,
                                    country=cfg.country,
                                    default_phone_region=cfg.country,
                                )
                            except Exception as exc:  # noqa: BLE001 — log and continue
                                LOG.warning("place %d/%d failed: %s", i, len(urls), exc)
                                skipped += 1
                                emitter.emit(ProgressEvent(
                                    stage=STAGE_DETAIL,
                                    event=EVT_ERROR,
                                    count=extracted + skipped,
                                    total=len(urls),
                                    message=f"{i}/{len(urls)} failed: {exc}",
                                    data={"index": i, "url": url},
                                ))
                                continue
                            if biz is None:
                                skipped += 1
                                emitter.emit(ProgressEvent(
                                    stage=STAGE_DETAIL,
                                    event=EVT_SKIP,
                                    count=extracted + skipped,
                                    total=len(urls),
                                    message=f"{i}/{len(urls)} skipped (no business data)",
                                    data={"index": i, "url": url},
                                ))
                                continue

                            # Resume support: skip already-scraped place_ids.
                            if biz.google_place_id and biz.google_place_id in seen:
                                LOG.debug("resume: skipping %s", biz.name[:30])
                                skipped += 1
                                emitter.emit(ProgressEvent(
                                    stage=STAGE_DETAIL,
                                    event=EVT_SKIP,
                                    count=extracted + skipped,
                                    total=len(urls),
                                    message=f"{i}/{len(urls)} skipped (resume)",
                                    data={"index": i, "name": biz.name, "reason": "resume"},
                                ))
                                continue

                            if cfg.extract_emails:
                                # Ako nema website, probaj Google pretragu za ime + grad
                                if not biz.website:
                                    emitter.emit(ProgressEvent(
                                        stage=STAGE_GOOGLE_FALLBACK,
                                        event=EVT_START,
                                        count=emailed,
                                        message=f"google fallback: {biz.name[:30]} (nema website)",
                                        data={"name": biz.name, "city": biz.city},
                                    ))
                                    try:
                                        gf = await google_fallback_for_website(page, biz.name, biz.city)
                                        if gf:
                                            picked = pick_best_website(gf["top_results"], biz.name)
                                            if picked:
                                                biz.website = picked
                                                biz.discovery_method = "maps+google"
                                                emitter.emit(ProgressEvent(
                                                    stage=STAGE_GOOGLE_FALLBACK,
                                                    event=EVT_END,
                                                    count=emailed,
                                                    message=f"google fallback: {biz.name[:30]} -> {picked}",
                                                    data={"name": biz.name, "website": picked, "n_results": len(gf["top_results"])},
                                                ))
                                            else:
                                                emitter.emit(ProgressEvent(
                                                    stage=STAGE_GOOGLE_FALLBACK,
                                                    event=EVT_ERROR,
                                                    count=emailed,
                                                    message=f"google fallback: {biz.name[:30]} - nema pouzdanog sajta u top 10",
                                                    data={"name": biz.name, "n_results": len(gf["top_results"])},
                                                ))
                                        else:
                                            emitter.emit(ProgressEvent(
                                                stage=STAGE_GOOGLE_FALLBACK,
                                                event=EVT_ERROR,
                                                count=emailed,
                                                message=f"google fallback: {biz.name[:30]} - Google nedostupan",
                                                data={"name": biz.name},
                                            ))
                                    except Exception as exc:
                                        emitter.emit(ProgressEvent(
                                            stage=STAGE_GOOGLE_FALLBACK,
                                            event=EVT_ERROR,
                                            count=emailed,
                                            message=f"google fallback fail: {exc}",
                                            data={"name": biz.name},
                                        ))

                                # Sada ako imamo website (originalan ili Google fallback), uradi:
                                # 1) Screenshot homepage-a
                                # 2) Email + phone extraction (homepage + kontaktstranica)
                                if biz.website:
                                    slug = _safe_slug(f"{biz.name}-{i}")

                                    # SCREENSHOT
                                    emitter.emit(ProgressEvent(
                                        stage=STAGE_SCREENSHOT,
                                        event=EVT_START,
                                        message=f"screenshot: {biz.name[:30]}",
                                        data={"name": biz.name, "website": biz.website},
                                    ))
                                    shot_dir = _screenshot_dir(cfg)
                                    shot_path = shot_dir / f"{slug}.png"
                                    try:
                                        ok = False
                                        # Reuse existing page if already on this site; else goto.
                                        cur = page.url if not page.is_closed() else ""
                                        from urllib.parse import urlparse as _up
                                        if _up(cur).netloc != _up(biz.website).netloc:
                                            await page.goto(biz.website, wait_until="domcontentloaded", timeout=12000)
                                            await page.wait_for_timeout(500)
                                        await page.screenshot(path=str(shot_path), full_page=False)
                                        biz.screenshot_path = str(shot_path)
                                        ok = True
                                        emitter.emit(ProgressEvent(
                                            stage=STAGE_SCREENSHOT,
                                            event=EVT_END,
                                            message=f"screenshot OK: {biz.name[:30]}",
                                            data={"name": biz.name, "path": biz.screenshot_path},
                                        ))
                                    except Exception as exc:
                                        emitter.emit(ProgressEvent(
                                            stage=STAGE_SCREENSHOT,
                                            event=EVT_ERROR,
                                            message=f"screenshot fail: {biz.name[:30]} ({exc})",
                                            data={"name": biz.name},
                                        ))
                                    del ok  # noqa

                                    # EMAIL + PHONES
                                    emitter.emit(ProgressEvent(
                                        stage=STAGE_CONTACT,
                                        event=EVT_START,
                                        count=emailed,
                                        message=f"contact: {biz.name[:30]}",
                                        data={"name": biz.name, "website": biz.website},
                                    ))
                                    try:
                                        result = await enrich_from_website(page, biz.website, screenshot_dir=shot_dir, slug=slug)
                                        if result.get("primary_email"):
                                            biz.email = result["primary_email"]
                                            emailed += 1
                                        if result.get("extra_emails"):
                                            extra = [e for e in result["extra_emails"] if e != biz.email]
                                            biz.extra_emails = json.dumps(extra, ensure_ascii=False) if extra else None
                                        if result.get("extra_phones"):
                                            biz.extra_phones = json.dumps(result["extra_phones"], ensure_ascii=False)
                                        emitter.emit(ProgressEvent(
                                            stage=STAGE_CONTACT,
                                            event=EVT_END,
                                            count=emailed,
                                            message=f"contact: {biz.name[:30]} -> email={biz.email or 'none'} +{len(result.get('extra_emails') or [])} extra emails",
                                            data={
                                                "name": biz.name,
                                                "primary_email": biz.email,
                                                "n_extra_emails": len(result.get("extra_emails") or []),
                                                "n_extra_phones": len(result.get("extra_phones") or []),
                                            },
                                        ))
                                    except Exception as exc:
                                        emitter.emit(ProgressEvent(
                                            stage=STAGE_CONTACT,
                                            event=EVT_ERROR,
                                            count=emailed,
                                            message=f"contact fail: {biz.name[:30]} ({exc})",
                                            data={"name": biz.name},
                                        ))
                                else:
                                    emitter.emit(ProgressEvent(
                                        stage=STAGE_CONTACT,
                                        event=EVT_SKIP,
                                        message=f"contact: {biz.name[:30]} - nema website",
                                        data={"name": biz.name},
                                    ))

                            # Enrich with feed-card data when the detail page missed it.
                            if feed_info:
                                if biz.rating is None and "rating" in feed_info:
                                    biz.rating = feed_info["rating"]
                                if biz.reviews_count is None and "reviews_count" in feed_info:
                                    biz.reviews_count = feed_info["reviews_count"]

                            out.add(biz)
                            if ckpt is not None and biz.google_place_id:
                                ckpt.append(biz)
                            extracted += 1
                            emitter.emit(ProgressEvent(
                                stage=STAGE_DETAIL,
                                event=EVT_END,
                                count=extracted + skipped,
                                total=len(urls),
                                message=f"{i}/{len(urls)} {biz.name[:30]}",
                                data={
                                    "index": i,
                                    "name": biz.name,
                                    "rating": biz.rating,
                                    "has_website": bool(biz.website),
                                },
                            ))
            emitter.emit(ProgressEvent(
                stage=STAGE_EXPORT,
                event=EVT_END,
                count=extracted,
                message=f"wrote {extracted} rows to {cfg.output_path}",
                data={"path": str(cfg.output_path)},
            ))
            emitter.emit(ProgressEvent(
                stage=STAGE_DONE,
                event=EVT_END,
                count=extracted,
                total=len(urls),
                message=(
                    f"done: {extracted} extracted, {skipped} skipped, "
                    f"{emailed} emails found, exit={exit_code}"
                ),
                data={
                    "extracted": extracted,
                    "skipped": skipped,
                    "emailed": emailed,
                    "exit_code": exit_code,
                    "output_path": str(cfg.output_path),
                },
            ))
            LOG.info(
                "runner: done — %d extracted, %d skipped, %d emails found",
                extracted,
                skipped,
                emailed,
            )
        finally:
            if ckpt is not None:
                ckpt.close()
    return exit_code


def main(args: argparse.Namespace) -> int:
    cfg = _to_run_config(args)
    _configure_logging(cfg)
    LOG.info(
        "starting: category=%s city=%s country=%s language=%s stealth=%s extract_emails=%s format=%s output=%s",
        cfg.category,
        cfg.city,
        cfg.country,
        cfg.language,
        cfg.stealth_tier,
        cfg.extract_emails,
        cfg.output_format,
        cfg.output_path,
    )
    try:
        return asyncio.run(_run(cfg))
    except KeyboardInterrupt:
        LOG.warning("interrupted — exit 130")
        return 130


__all__ = ["main", "_to_run_config"]
