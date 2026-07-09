"""Content audit — readability, thin pages, duplicate detection, headings.

Inputs: each page dict carries::

    {
      "url": str,
      "title": str|None,
      "h1": str|None,
      "headings": [{"level": int, "text": str}, ...],
      "word_count": int,
      "body_text": str,    # first ~2000 chars of trafilatura body
      "language": str|None,
    }

We deliberately do not store the entire body in the DB — we work with the
trafilatura text fetched during the audit run.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
import re
import statistics


@dataclass
class ContentResult:
    raw: dict
    score: int
    issues: list[str]


# ---------------------------------------------------------------------------
# Public entry
# ---------------------------------------------------------------------------

def audit_content(pages: list[dict]) -> ContentResult:
    if not pages:
        return ContentResult(raw={"empty": True}, score=0, issues=["No pages."])

    word_counts = [p.get("word_count", 0) for p in pages]
    avg_words = _mean(word_counts)

    thin_pages = sum(1 for w in word_counts if 0 < w < 300)
    empty_pages = sum(1 for w in word_counts if w == 0)
    thin_pct = round(thin_pages / len(pages) * 100)

    # Readability (use first page as primary sample)
    flesch = _flesch_reading_ease(pages[0].get("body_text", ""))
    avg_sentence_len = _avg_sentence_length(pages[0].get("body_text", ""))

    # Heading hierarchy
    hierarchy_issues = _hierarchy_issues(pages)

    # Duplicate detection
    dup_clusters, dup_pct = _duplicate_stats(pages)

    checks = {
        "avg_words_ok": avg_words >= 300,
        "avg_words_good": avg_words >= 600,
        "thin_low": thin_pct <= 15,
        "thin_good": thin_pct <= 5,
        "empty_pages_ok": empty_pages == 0,
        "readability_ok": flesch is None or flesch >= 30,
        "readability_good": flesch is None or flesch >= 50,
        "hierarchy_clean": not hierarchy_issues,
        "duplicates_low": dup_pct <= 15,
        "duplicates_good": dup_pct <= 5,
    }

    score = _score_checks(checks)
    raw = {
        "pages_analyzed": len(pages),
        "avg_word_count": round(avg_words),
        "median_word_count": round(_median(word_counts)),
        "word_count_min": min(word_counts),
        "word_count_max": max(word_counts),
        "thin_pages_pct": thin_pct,
        "empty_pages": empty_pages,
        "flesch_reading_ease_homepage": flesch,
        "avg_sentence_length_homepage": round(avg_sentence_len, 1),
        "heading_hierarchy_issues": hierarchy_issues,
        "duplicate_clusters": dup_clusters,
        "duplicate_pages_pct": dup_pct,
    }

    issues = _issues_for(checks, raw)
    return ContentResult(raw=raw, score=score, issues=issues)


# ---------------------------------------------------------------------------
# Readability: Flesch Reading Ease
# ---------------------------------------------------------------------------

_VOWEL_RE = re.compile(r"[aeiouy]+", re.IGNORECASE)
_SENTENCE_RE = re.compile(r"[.!?]+(?:\s|$)")


def _flesch_reading_ease(text: str) -> float | None:
    """Standard Flesch Reading Ease for English-ish text.

    206.835 − 1.015 (words / sentences) − 84.6 (syllables / words).
    Returns None for texts with too few sentences/words to score.
    """
    if not text:
        return None
    sentences = _SENTENCE_RE.split(text)
    sentences = [s.strip() for s in sentences if len(s.strip().split()) >= 3]
    if len(sentences) < 2:
        return None

    words = re.findall(r"\b\w+\b", text)
    if len(words) < 30:
        return None

    syllables = sum(_syllables(w) for w in words)
    asl = len(words) / len(sentences)
    asw = syllables / len(words)
    score = 206.835 - 1.015 * asl - 84.6 * asw
    return round(score, 1)


def _syllables(word: str) -> int:
    """Approximate syllable count for English words."""
    w = word.lower().strip(".,!?;:")
    if not w:
        return 0
    if len(w) <= 3:
        return 1
    count = len(_VOWEL_RE.findall(w))
    # Silent trailing 'e'
    if w.endswith("e") and not w.endswith("le"):
        count -= 1
    return max(1, count)


def _avg_sentence_length(text: str) -> float:
    sentences = [s for s in _SENTENCE_RE.split(text) if s.strip()]
    if not sentences:
        return 0.0
    words = re.findall(r"\b\w+\b", text)
    return len(words) / max(1, len(sentences))


# ---------------------------------------------------------------------------
# Heading hierarchy
# ---------------------------------------------------------------------------

def _hierarchy_issues(pages: list[dict]) -> list[dict]:
    """For each page, flag skipped levels (e.g., h1 → h3 without h2).

    Returns a list of small dicts: ``{url, problems: [...]}``.
    """
    issues = []
    for p in pages:
        headings = p.get("headings") or []
        levels = [h["level"] for h in headings if h.get("level")]
        problems = []
        last = 0
        for lv in levels:
            if last and lv > last + 1:
                # h1 → h3 etc.
                problems.append(f"skipped from h{last} to h{lv}")
            last = lv
        # Multiple h1s? Allow them but warn.
        h1_count = sum(1 for lv in levels if lv == 1)
        if h1_count > 1:
            problems.append(f"{h1_count} h1 tags (one is canonical)")

        # No h1 at all?
        if h1_count == 0 and any(lv > 1 for lv in levels):
            problems.append("no h1 but other headings present")

        if problems:
            issues.append({"url": p.get("url"), "problems": problems})
    return issues


# ---------------------------------------------------------------------------
# Duplicate detection — hashed shingles of (h1 + first 200 chars body)
# ---------------------------------------------------------------------------

_SPLIT_RE = re.compile(r"\W+", re.UNICODE)


def _shingles(text: str, k: int = 3) -> set[str]:
    tokens = [t for t in _SPLIT_RE.split(text.lower()) if t]
    if len(tokens) < k:
        return {" ".join(tokens)}
    return {" ".join(tokens[i:i + k]) for i in range(len(tokens) - k + 1)}


def _jaccard(a: set, b: set) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def _duplicate_stats(pages: list[dict], threshold: float = 0.75) -> tuple[list[dict], int]:
    """Group pages whose (h1 + first 200 chars body) Jaccard >= threshold.

    Returns ``(clusters, duplicate_pages_pct)`` where each cluster is::

        {"representative": url, "pages": [url, ...], "similarity": float}
    """
    sigs = []
    for p in pages:
        body = (p.get("body_text") or "")[:200]
        h1 = p.get("h1") or ""
        sig = (h1 + " " + body).strip()
        sigs.append((p.get("url"), _shingles(sig)))

    # Union-Find
    parent = {u: u for u, _ in sigs}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    n = len(sigs)
    sims = []
    for i in range(n):
        for j in range(i + 1, n):
            ui, si = sigs[i]
            uj, sj = sigs[j]
            sim = _jaccard(si, sj)
            sims.append(sim)
            if sim >= threshold:
                union(ui, uj)

    groups: dict[str, list[str]] = {}
    for u, _ in sigs:
        groups.setdefault(find(u), []).append(u)

    clusters = []
    dup_pages = 0
    for rep, urls in groups.items():
        if len(urls) > 1:
            clusters.append({"representative": rep, "pages": urls, "similarity": round(threshold, 2)})
            dup_pages += len(urls) - 1  # count all-but-the-first as duplicate

    dup_pct = round(dup_pages / max(1, n) * 100)
    return clusters, dup_pct


# ---------------------------------------------------------------------------
# Aggregates + scoring + issues
# ---------------------------------------------------------------------------

def _mean(xs: list[float]) -> float:
    return statistics.mean(xs) if xs else 0.0


def _median(xs: list[float]) -> float:
    return statistics.median(xs) if xs else 0.0


def _score_checks(checks: dict) -> int:
    score = 0
    # Word count depth (up to 30)
    if checks["avg_words_good"]:
        score += 30
    elif checks["avg_words_ok"]:
        score += 16
    # Thin + empty (up to 25)
    if checks["thin_good"]:
        score += 20
    elif checks["thin_low"]:
        score += 10
    if checks["empty_pages_ok"]:
        score += 5
    # Readability (up to 20)
    if checks["readability_good"]:
        score += 20
    elif checks["readability_ok"]:
        score += 10
    # Hierarchy (up to 10)
    if checks["hierarchy_clean"]:
        score += 10
    # Duplicates (up to 15)
    if checks["duplicates_good"]:
        score += 15
    elif checks["duplicates_low"]:
        score += 7
    return min(100, score)


def _issues_for(checks: dict, raw: dict) -> list[str]:
    out = []
    if not checks["avg_words_ok"]:
        out.append(f"Average page has only {raw['avg_word_count']} words — under 300 is too thin for SEO.")
    elif not checks["avg_words_good"]:
        out.append(f"Average page has {raw['avg_word_count']} words — solid but room to grow (target 600+).")
    if not checks["thin_low"]:
        out.append(f"{raw['thin_pages_pct']}% of pages are thin (<300 words). Consider expanding or consolidating.")
    if not checks["empty_pages_ok"]:
        out.append(f"{raw['empty_pages']} page(s) returned with 0 words extracted.")
    if raw.get("flesch_reading_ease_homepage") is not None and not checks["readability_ok"]:
        out.append(f"Flesch reading ease on homepage is {raw['flesch_reading_ease_homepage']} — hard to read.")
    elif raw.get("flesch_reading_ease_homepage") is not None and not checks["readability_good"]:
        out.append(f"Flesch reading ease {raw['flesch_reading_ease_homepage']} — workable but plain.")
    if not checks["hierarchy_clean"]:
        # Surface the first 3 problems verbatim
        for h in raw["heading_hierarchy_issues"][:3]:
            problems = ", ".join(h["problems"])
            out.append(f"Heading hierarchy issue on {h['url']}: {problems}")
    if not checks["duplicates_low"]:
        out.append(f"{raw['duplicate_pages_pct']}% of pages are near-duplicates of each other — risk of keyword cannibalisation.")
    return out
