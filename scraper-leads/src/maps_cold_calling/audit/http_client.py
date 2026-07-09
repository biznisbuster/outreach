"""Polite HTTP client for the audit pipeline.

Wraps :mod:`httpx.AsyncClient` with:
- desktop-Chrome User-Agent
- follow-redirects
- HEAD probe before GET (so we record redirect chain + final URL)
- per-host concurrency semaphore
- helper that returns both final URL, full response, and timing
"""

from __future__ import annotations

import asyncio
import logging
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

import httpx

LOG = logging.getLogger(__name__)

UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36"
)

DEFAULT_TIMEOUT = httpx.Timeout(15.0, connect=8.0)


@dataclass
class FetchResult:
    url: str                                          # final URL after redirects
    requested_url: str                                # what was asked
    status: int | None = None
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None
    elapsed_ms: int = 0
    redirects: int = 0
    https: bool = True
    error: str | None = None


def _redirect_count(response: httpx.Response) -> int:
    """httpx doesn't expose the redirect chain directly; parse from header."""
    # The previous response history is in response.history. We can count it.
    return len(response.history) if hasattr(response, "history") else 0


class AuditHttp:
    """Bundles an httpx.AsyncClient with per-host concurrency control."""

    def __init__(
        self,
        *,
        max_concurrency_per_host: int = 2,
        timeout: httpx.Timeout | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            timeout=timeout or DEFAULT_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": UA, "Accept": "*/*"},
            http2=False,
        )
        self._sem_by_host: dict[str, asyncio.Semaphore] = {}
        self._max_per_host = max_concurrency_per_host

    def _host_sem(self, url: str) -> asyncio.Semaphore:
        host = (urlparse(url).hostname or "").lower()
        sem = self._sem_by_host.get(host)
        if sem is None:
            sem = asyncio.Semaphore(self._max_per_host)
            self._sem_by_host[host] = sem
        return sem

    async def fetch(self, url: str, *, method: str = "GET") -> FetchResult:
        """Fetch a URL, return a populated :class:`FetchResult`.

        Honors per-host concurrency. Errors are caught and surfaced via
        ``result.error`` so the caller can record them on the row.
        """
        sem = self._host_sem(url)
        out = FetchResult(url=url, requested_url=url)
        try:
            parsed = urlparse(url)
            out.https = parsed.scheme.lower() == "https"
            async with sem:
                t0 = time.perf_counter()
                if method == "HEAD":
                    resp = await self._client.head(url)
                    out.body = None
                else:
                    resp = await self._client.get(url)
                    out.body = resp.content
                out.elapsed_ms = int((time.perf_counter() - t0) * 1000)
            out.status = resp.status_code
            out.url = str(resp.url)
            out.redirects = _redirect_count(resp)
            # Case-insensitive header view
            out.headers = {k.lower(): v for k, v in resp.headers.items()}
        except httpx.HTTPError as exc:
            out.error = f"{type(exc).__name__}: {exc}"
            LOG.debug("fetch: %s -> error %s", url, out.error)
        except Exception as exc:  # noqa: BLE001
            out.error = f"{type(exc).__name__}: {exc}"
            LOG.debug("fetch: %s -> unexpected %s", url, out.error)
        return out

    async def head(self, url: str) -> FetchResult:
        return await self.fetch(url, method="HEAD")

    async def get(self, url: str) -> FetchResult:
        return await self.fetch(url, method="GET")

    async def close(self) -> None:
        try:
            await self._client.aclose()
        except Exception:  # noqa: BLE001
            pass


__all__ = ["AuditHttp", "FetchResult"]
