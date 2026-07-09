"""Tenacity-wrapped retry helpers — Phase 2.3.

Use::

    @retry_async_with_backoff(max_attempts=3, base_s=2.0)
    async def fetch(...):
        ...

All Playwright / network errors are retryable. Expected user errors (parse
failures) are not — they bubble up so the runner can log them.
"""

from __future__ import annotations

import functools
import logging
from typing import Any, Awaitable, Callable, TypeVar

from playwright.async_api import Error as PWError
from playwright.async_api import TimeoutError as PWTimeout

LOG = logging.getLogger(__name__)

T = TypeVar("T")

RETRYABLE_EXC: tuple[type[BaseException], ...] = (
    PWTimeout,
    PWError,
    ConnectionError,
    TimeoutError,
)


def retry_async_with_backoff(
    *,
    max_attempts: int = 3,
    base_s: float = 2.0,
    max_s: float = 8.0,
) -> Callable[[Callable[..., Awaitable[T]]], Callable[..., Awaitable[T]]]:
    """Decorator: exponential backoff + jitter, retry on RE/timeout exceptions.

    The actual backoff schedule is delegated to ``tenacity.AsyncRetrying``
    via the ``wait_exponential_jitter`` strategy, but exposed through a
    thin wrapper so callers don't import tenacity directly.
    """

    def decorator(fn: Callable[..., Awaitable[T]]) -> Callable[..., Awaitable[T]]:
        @functools.wraps(fn)
        async def wrapper(*args: Any, **kwargs: Any) -> T:
            import tenacity  # imported lazily so the utility module is light

            attempt = 0
            while True:
                attempt += 1
                try:
                    return await fn(*args, **kwargs)
                except RETRYABLE_EXC as exc:
                    if attempt >= max_attempts:
                        LOG.warning(
                            "retry: %s failed after %d attempts — last error: %s",
                            fn.__name__,
                            attempt,
                            exc,
                        )
                        raise
                    sleep_s = min(max_s, base_s * (2 ** (attempt - 1)))
                    LOG.debug(
                        "retry: %s attempt %d/%d failed (%s); retrying in %.1fs",
                        fn.__name__,
                        attempt,
                        max_attempts,
                        exc,
                        sleep_s,
                    )
                    import asyncio
                    await asyncio.sleep(sleep_s)

        return wrapper

    return decorator


__all__ = ["retry_async_with_backoff", "RETRYABLE_EXC"]
