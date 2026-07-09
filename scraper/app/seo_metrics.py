"""Izračunavanje SEO metrika po stranici."""


def compute_seo_metrics(
    title: str | None,
    meta_desc: str | None,
    h1: str | None,
    word_count: int,
    img_total: int,
    img_with_alt: int,
    internal_links: int,
    external_links: int,
    structured: dict,
) -> dict:
    title_len = len(title) if title else 0
    desc_len = len(meta_desc) if meta_desc else 0

    # optimalne dužine
    title_optimal = 30 <= title_len <= 60
    desc_optimal = 70 <= desc_len <= 160
    has_h1 = bool(h1)
    has_title = bool(title)
    has_desc = bool(meta_desc)

    alt_ratio = (img_with_alt / img_total) if img_total > 0 else 1.0

    # struktuirani podaci tip
    sd_types = []
    for k, v in structured.items():
        if isinstance(v, list):
            for item in v:
                if isinstance(item, dict) and "@type" in item:
                    t = item["@type"]
                    sd_types.append(t if isinstance(t, str) else str(t))
    has_jsonld = "json-ld" in structured

    content_ok = word_count >= 300

    # skor 0–100 (grubi)
    score = 0
    if has_title:
        score += 15
    if title_optimal:
        score += 10
    if has_desc:
        score += 10
    if desc_optimal:
        score += 10
    if has_h1:
        score += 10
    if content_ok:
        score += 15
    if alt_ratio >= 0.8:
        score += 10
    elif alt_ratio >= 0.5:
        score += 5
    if has_jsonld or sd_types:
        score += 10
    if internal_links >= 2:
        score += 10

    return {
        "title": title or "",
        "title_length": title_len,
        "title_optimal": title_optimal,
        "meta_description": meta_desc or "",
        "meta_length": desc_len,
        "meta_optimal": desc_optimal,
        "has_h1": has_h1,
        "h1_count": 1 if has_h1 else 0,
        "word_count": word_count,
        "content_ok": content_ok,
        "image_total": img_total,
        "image_with_alt": img_with_alt,
        "alt_ratio": round(alt_ratio, 2),
        "internal_links": internal_links,
        "external_links": external_links,
        "has_structured_data": has_jsonld or len(sd_types) > 0,
        "structured_types": sd_types,
        "score": min(100, score),
    }


def aggregate_metrics(pages: list[dict]) -> dict:
    """Agregat preko svih stranica sajta — za SEO sumar (Faza 3)."""
    if not pages:
        return {}
    n = len(pages)
    scores = [p.get("seo_metrics", {}).get("score", 0) for p in pages]
    word_counts = [p.get("word_count", 0) for p in pages]
    titles_optimal = sum(1 for p in pages if p.get("seo_metrics", {}).get("title_optimal"))
    metas_optimal = sum(1 for p in pages if p.get("seo_metrics", {}).get("meta_optimal"))
    alts = [p.get("seo_metrics", {}).get("alt_ratio", 0) for p in pages]
    has_sd = sum(1 for p in pages if p.get("seo_metrics", {}).get("has_structured_data"))

    return {
        "total_pages": n,
        "avg_score": round(sum(scores) / n, 1) if scores else 0,
        "avg_word_count": round(sum(word_counts) / n) if word_counts else 0,
        "total_words": sum(word_counts),
        "title_optimal_pct": round(titles_optimal / n * 100),
        "meta_optimal_pct": round(metas_optimal / n * 100),
        "avg_alt_ratio": round(sum(alts) / n, 2) if alts else 0,
        "structured_data_pct": round(has_sd / n * 100),
        "categories": _category_breakdown(pages),
    }


def _category_breakdown(pages: list[dict]) -> dict:
    out: dict[str, int] = {}
    for p in pages:
        c = p.get("category", "Other")
        out[c] = out.get(c, 0) + 1
    return out
