"""Phone normalization via Google's ``phonenumbers`` library.

E.164 output looks like ``+381601234567``. The library needs a default region
(``RS`` here) to handle local-format numbers like ``037/422-232`` →
``+38137422232``. Unparseable numbers return ``None``.
"""

from __future__ import annotations

import logging
import re

import phonenumbers

LOG = logging.getLogger(__name__)

# Strip common Serbian separators before parsing as a fallback.
_DANGEROUS_CHARS = re.compile(r"[^\d+]")


def normalize(raw: str | None, *, default_region: str = "RS") -> str | None:
    """Return the E.164 form (``+381601234567``) or ``None`` if unparseable."""
    if not raw:
        return None
    # Quick first parse — phonenumbers expects the raw text, but a tiny clean
    # makes local formats with spaces/dashes workable.
    candidate = raw.strip()
    try:
        num = phonenumbers.parse(candidate, default_region)
    except phonenumbers.NumberParseException as exc:
        LOG.debug("phone: first parse failed for %r (%s); retrying digits-only", candidate, exc)
        digits_only = _DANGEROUS_CHARS.sub("", candidate)
        if not digits_only:
            return None
        try:
            num = phonenumbers.parse(digits_only, default_region)
        except phonenumbers.NumberParseException as exc2:
            LOG.debug("phone: second parse failed for %r (%s)", digits_only, exc2)
            return None

    if not phonenumbers.is_possible_number(num):
        return None
    if not phonenumbers.is_valid_number(num):
        return None
    return phonenumbers.format_number(num, phonenumbers.PhoneNumberFormat.E164)


__all__ = ["normalize"]
