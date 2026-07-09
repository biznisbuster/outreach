"""Progress event types for the scraper.

The scraper emits :class:`ProgressEvent` objects at every meaningful step
so an integrating webapp can show a live progress bar / status panel.

Two ways to consume events:

1. **In-process (callback)** — pass ``on_progress=callable`` to
   :class:`RunConfig`. The callable is invoked synchronously on every
   event. Exceptions inside the callback are logged and swallowed
   (the scraper never crashes because the integrator did).

2. **Subprocess (JSON-lines on stdout)** — pass
   ``progress_stdout=True`` to :class:`RunConfig`. The scraper prints
   one JSON line per event to stdout (``{"type": "progress", ...}``).
   The integrating webapp can `subprocess.Popen` and read line-by-line.
   All normal log output goes to stderr; only progress events go to
   stdout so they're easy to filter.

3. **Polling (file)** — pass ``progress_file=Path(...)`` to
   :class:`RunConfig`. The scraper writes a JSON snapshot of the latest
   state to the file after every event. The webapp can ``stat()`` and
   read the file. Useful when you can't pipe stdout (e.g. running under
   systemd) or want to keep a historical record.
"""

from __future__ import annotations

import json
import logging
import sys
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

LOG = logging.getLogger(__name__)

# Stage identifiers. Add a new constant when introducing a new stage so
# integrators can switch on it safely.
STAGE_STARTUP = "startup"          # browser launch, session bring-up
STAGE_SEARCH = "search"            # Maps search + scroll
STAGE_DETAIL = "detail"            # per-business place-page extraction
STAGE_SCREENSHOT = "screenshot"    # homepage screenshot capture
STAGE_CONTACT = "contact"          # scrape emails + phones from website
STAGE_EMAIL = "email"              # alias kept for compat
STAGE_GOOGLE_FALLBACK = "google_fallback"  # Google search for missing website
STAGE_CAPTCHA = "captcha"          # captcha / block detected
STAGE_EXPORT = "export"            # writing CSV/JSON
STAGE_DONE = "done"                # final summary

# Event types within a stage.
EVT_START = "start"
EVT_PROGRESS = "progress"
EVT_END = "end"
EVT_SKIP = "skip"
EVT_ERROR = "error"


@dataclass
class ProgressEvent:
    """One progress tick emitted by the scraper.

    Always serializable to JSON. Integrators should switch on ``stage``
    first, then ``event``.
    """

    stage: str
    event: str
    count: int = 0                       # running tally (businesses processed)
    total: int | None = None             # if known, e.g. expected max-results
    message: str = ""
    timestamp: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds"))
    data: dict[str, Any] = field(default_factory=dict)

    def to_json(self) -> str:
        d = asdict(self)
        return json.dumps(d, ensure_ascii=False)


# A callback receives one event. ``None`` disables callback-mode.
ProgressCallback = Callable[[ProgressEvent], None]


class ProgressEmitter:
    """Routes progress events to a callback, a file, and/or stdout.

    All three sinks are independent. The emitter itself never raises —
    any failure in a sink is logged and swallowed so a misbehaving
    integrator can't break the scraper.
    """

    def __init__(
        self,
        *,
        callback: ProgressCallback | None = None,
        file_path: Path | None = None,
        stdout: bool = False,
    ) -> None:
        self._callback = callback
        self._file = file_path
        self._stdout = stdout
        self._last_count: int = 0

    def emit(self, event: ProgressEvent) -> None:
        # 1. Callback
        if self._callback is not None:
            try:
                self._callback(event)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("progress: callback raised %s; ignoring", exc)

        # 2. Stdout (JSON-line). Tag the line with type=progress so the
        #    integrator can grep for it without colliding with other
        #    stdout output.
        if self._stdout:
            try:
                sys.stdout.write('{"type":"progress",' + event.to_json()[1:] + "\n")
                sys.stdout.flush()
            except Exception as exc:  # noqa: BLE001
                LOG.warning("progress: stdout write failed: %s", exc)

        # 3. File. Write the latest snapshot, overwriting each time.
        #    Use atomic-ish write (write to .tmp then rename) so a
        #    concurrent reader never sees a half-written file.
        if self._file is not None:
            try:
                payload = {
                    "last_event": asdict(event),
                    "last_count": event.count,
                    "last_update": event.timestamp,
                }
                tmp = self._file.with_suffix(self._file.suffix + ".tmp")
                tmp.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                tmp.replace(self._file)
            except Exception as exc:  # noqa: BLE001
                LOG.warning("progress: file write failed: %s", exc)

        self._last_count = event.count

    @property
    def last_count(self) -> int:
        return self._last_count


class NullEmitter:
    """No-op emitter used when the caller passes ``None`` / no flag.

    Exists so the runner can call ``emitter.emit(...)`` unconditionally
    without checking for None at every call site.
    """

    def emit(self, event: ProgressEvent) -> None:  # pragma: no cover
        return None

    @property
    def last_count(self) -> int:  # pragma: no cover
        return 0


__all__ = [
    "ProgressEvent",
    "ProgressCallback",
    "ProgressEmitter",
    "NullEmitter",
    "STAGE_STARTUP",
    "STAGE_SEARCH",
    "STAGE_DETAIL",
    "STAGE_EMAIL",
    "STAGE_CAPTCHA",
    "STAGE_EXPORT",
    "STAGE_DONE",
    "EVT_START",
    "EVT_PROGRESS",
    "EVT_END",
    "EVT_SKIP",
    "EVT_ERROR",
]
