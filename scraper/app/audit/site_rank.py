"""Multi-criteria site ranking.

Pure function: takes a flat ``signals`` dict assembled by ``runner.run_audit``
(per-page raw + site-wide raw) and produces the final overall_rank, verdict,
and per-category breakdown. Lives separately so it can be unit-tested without
network IO.

Verdict thresholds (matches user's example exactly):

    0–30   -> critical   -> "aggressive pitch"
    31–55  -> below_avg  -> "strong pitch"
    56–70  -> average    -> "worth pitching"
    71–85  -> good       -> "cautious"
    86–100 -> excellent  -> "skip"
"""
from __future__ import annotations

from dataclasses import dataclass


# ---------------------------------------------------------------------------
# Weights (must sum to 1.0)
# ---------------------------------------------------------------------------

WEIGHTS = {
    "seo":          0.25,
    "performance":  0.20,
    "content":      0.20,
    "security":     0.10,
    "mobile_a11y":  0.10,
    "tech_modern":  0.05,
    "authority":    0.10,
}


# ---------------------------------------------------------------------------
# Verdict
# ---------------------------------------------------------------------------

_VERDICT_BANDS = [
    (30, "critical",   "🔴 Critical"),
    (55, "below_avg",  "🟠 Below average"),
    (70, "average",    "🟡 Average"),
    (85, "good",       "🟢 Good"),
    (101, "excellent", "🟢 Excellent"),
]

_PITCH_ADVICE = {
    "critical":   "Aggressive pitch — site is broken or unfinished, easy win.",
    "below_avg":  "Strong pitch — many gaps, clear upsell story.",
    "average":    "Worth pitching — room for improvement.",
    "good":       "Cautious — already competent. Pitch only premium services.",
    "excellent":  "Skip — likely to reject your pitch.",
}


def verdict_for(score: int) -> tuple[str, str, str]:
    """Return ``(verdict_key, verdict_label, pitch_advice)``."""
    for cutoff, key, label in _VERDICT_BANDS:
        if score <= cutoff:
            return key, label, _PITCH_ADVICE[key]
    return "excellent", _VERDICT_BANDS[-1][2], _PITCH_ADVICE["excellent"]


# ---------------------------------------------------------------------------
# Authority scoring (depends on traffic signals)
# ---------------------------------------------------------------------------

def authority_score(traffic: dict, onpage_raw: dict) -> tuple[int, list[str]]:
    """0-100 from Tranco rank + Open PageRank + socials + contact info.

    Sub-scores:
        Tranco          0–50    (logarithmic, capped at 50)
        Open PageRank   0–20    (10x the 0-10 score, capped at 20)
        Socials         0–20    (4+ = 20, 3 = 16, 2 = 12, 1 = 6)
        Contact info    0–10    (email + phone + address, +3 / +4 / +3)

    Sum is 100. When a provider is unavailable we just SKIP it (no inflation):
    a small local-business site that isn't in Tranco's top 1M and has no OPR
    key still gets up to 50 points purely from social + contact.
    """
    issues = []

    # Tranco (lower rank better; cap at 0-50)
    tranco = traffic.get("tranco")
    tranco_pts = 0
    tranco_note = None
    if tranco and tranco.get("rank"):
        rank = tranco["rank"]
        import math
        # log10: rank 1 = 100, rank 100 ≈ 75, rank 10k ≈ 50, rank 100k ≈ 25,
        # rank 1M ≈ 0. We re-scale to a 0-50 contribution.
        raw = max(0, 100 - 25 * math.log10(max(1, rank)))
        tranco_pts = round(min(50, raw * 0.5))
    elif tranco and tranco.get("rank") is None:
        # Domain not in top 1M — explicit signal of a small / niche site.
        tranco_pts = 0
        tranco_note = "Domain not in Tranco top-1M (small / niche site — typical for local businesses)."

    # Open PageRank (0-10 -> × 2 capped at 20)
    opr = traffic.get("open_page_rank")
    opr_pts = 0
    if opr and opr.get("rank") is not None:
        opr_pts = round(min(20, opr["rank"] * 2))

    # Socials (20 max): 4+ = 20, 3 = 16, 2 = 12, 1 = 6
    sc = onpage_raw.get("social_count", 0)
    if sc >= 4:
        social_pts = 20
    elif sc == 3:
        social_pts = 16
    elif sc == 2:
        social_pts = 12
    elif sc == 1:
        social_pts = 6
    else:
        social_pts = 0

    # Contact info (10 max): email +3, phone +4, address +3
    contact_pts = 0
    if onpage_raw.get("emails"):
        contact_pts += 3
    if onpage_raw.get("phones"):
        contact_pts += 4
    if onpage_raw.get("addresses"):
        contact_pts += 3

    score = tranco_pts + opr_pts + social_pts + contact_pts
    score = min(100, score)

    # Issues — only report the strongest signal-gaps
    if tranco_note:
        issues.append(tranco_note)
    if sc == 0:
        issues.append("No social-media presence detected.")
    elif sc <= 2:
        issues.append(f"Only {sc} social-media link(s) — typical authority sites have 3+.")
    if not onpage_raw.get("emails"):
        issues.append("No business email found.")
    if not onpage_raw.get("phones"):
        issues.append("No phone number found.")

    return score, issues


# ---------------------------------------------------------------------------
# Top-level: combine per-category scores
# ---------------------------------------------------------------------------

def compute_overall(category_scores: dict[str, int]) -> tuple[int, dict, dict]:
    """Given ``{"seo": 75, "performance": 60, ...}`` return ``(overall, ranked, verdict)``.

    Returns:
        overall_rank: int 0-100 (rounded)
        ranked: dict {category: {score, weight, weighted, issues}}
        verdict: dict {key, label, advice}
    """
    ranked = {}
    overall = 0.0
    for cat, weight in WEIGHTS.items():
        score = int(category_scores.get(cat, 0))
        weighted = round(score * weight, 1)
        overall += weighted
        ranked[cat] = {
            "score": score,
            "weight": weight,
            "weighted": weighted,
            "issues": category_scores.get(cat + "_issues", []) or [],
        }
    overall = round(overall)
    v_key, v_label, v_advice = verdict_for(overall)
    return overall, ranked, {"key": v_key, "label": v_label, "advice": v_advice}
