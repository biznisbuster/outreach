"""ui_design.py — AI-asistent za vizuelni UI/UX dizajn homepage-a.

Šalje downscaled screenshot na ``$MINIMAX_BASE_URL/chat/completions`` sa
multimodal sadržajem (slika + prompt) i traži od MiniMax M3 da oceni dizajn
na skali 0–100, sa listom detektovanih UI/UX problema i kratkim rezimeom.

**Graceful fallback:**
    - Nema ``MINIMAX_API_KEY`` → vrati ``score=None``, ``skipped=True``
    - MiniMax API error / timeout / nevalidan response → vrati default 50
      sa jasnim problemom u ``issues``
    - Slika ne postoji / ne može da se otvori → vrati ``skipped=True``

Rezultat se uvodi kao **nova kategorija ``ui_design``** u ukupni overall_rank
sa težinom 0.05 (podesivo u ``site_rank.WEIGHTS``).
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import sys
import time
from pathlib import Path

# Pillow je već u scraper dependencies (pyproject.toml); koristimo ga samo ako
# je dostupan — u suprotnom šaljemo originalnu sliku.
try:
    from PIL import Image  # type: ignore
    _HAS_PIL = True
except Exception:  # noqa: BLE001
    _HAS_PIL = False


# Default vrednosti (fail-safe)
WEIGHT = 0.05
DEFAULT_SCORE = 50

MAX_IMG_DIM = 1280          # piksela (duža strana) — dovoljno za vizuelni review
JPEG_QUALITY = 78           # balans kvalitet / veličina
TIMEOUT_SEC = 90            # MiniMax M3 (reasoning model) može da bude spor za multimodal
MAX_PROMPT_TOKENS = 2000    # MiniMax M3 troši ~500-800 tokena na reasoning pre finalnog JSON-a;
                            # 2000 ostavlja dovoljno prostora za kompletan {"score",..., "issues":[...8 stavki]}

_PROMPT = (
    "Ti si iskusan UI/UX dizajn review-er. Analiziraj vizuelni dizajn (UI/UX) "
    "homepage-a web sajta na prilo\u017eenoj slici.\n\n"
    "Daj jednu ukupnu ocenu (ceo broj 0\u2013100) i listu problema. Ocena se "
    "ra\u010duna po slede\u0107oj rubrici (svaka kategorija 0\u2013100; ukupna "
    "ocena je te\u017einska prose\u010dna vrednost):\n"
    "- 25% Moderan, profesionalan vizuelni identitet (logo, paleta, fontovi)\n"
    "- 20% Hijerarhija i \u010ditljivost (jasno\u0107a naslova, kontrast, "
    "veli\u010dina teksta, white-space)\n"
    "- 20% Raspored i balans elemenata (grid, layout, poravnanje)\n"
    "- 15% Doslednost dizajna (boje, fontovi, spacing, ivice)\n"
    "- 10% Pozivi na akciju (vidljivi, kontrastni, jasni)\n"
    "- 10% Pristupa\u010dnost vizuelno (kontrast boja, veli\u010dina dugmadi)\n\n"
    "VA\u017dNO: Razmisli kratko, zatim output-uj ISKLJU\u010cIVO JSON (bez "
    "thinking bloka, bez markdowna, bez dodatnog teksta). JSON format:\n"
    '{"score":<ceo broj 0-100>,"summary":"<kratak 1-2 re\u010deni opis ukupnog '
    'utiska>","issues":["<konkretan UI/UX problem>"]}\n\n'
    "Maksimalno 8 issues; fokusiraj se na najuticajnije. Budi konkretan. "
    "Pi\u0161i na srpskom jeziku."
)


# ---------------------------------------------------------------------------
# Image preprocessing
# ---------------------------------------------------------------------------


def _prepare_image_for_api(image_path: str) -> tuple[str, str] | None:
    """Pro\u010ditaj sliku i pripremi za slanje.

    Vraća ``(base64_data_uri, mime_type)`` ili ``None`` ako nije mogu\u0107e
    pripremiti sliku. Ako Pillow nije dostupan, \u0161alje originalni PNG.
    """
    p = Path(image_path)
    if not p.is_file() or p.stat().st_size == 0:
        return None

    if not _HAS_PIL:
        # Bez Pillow \u2014 \u0161alji originalni fajl kao PNG ako je mali, ina\u010de None.
        if p.stat().st_size > 4 * 1024 * 1024:  # 4MB \u2014 ve\u0107ina API-ja odbija veće
            return None
        data = p.read_bytes()
        return ("data:image/png;base64," + base64.b64encode(data).decode("ascii"), "image/png")

    try:
        img = Image.open(p)
        # Konverzuj u RGB ako je RGBA/P (JPEG ne podržava alpha)
        if img.mode not in ("RGB",):
            img = img.convert("RGB")
        # Downscale na MAX_IMG_DIM (duža strana)
        img.thumbnail((MAX_IMG_DIM, MAX_IMG_DIM), Image.LANCZOS)
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=JPEG_QUALITY, optimize=True)
        size = buf.tell()
        if size > 4 * 1024 * 1024:
            # Ako je i dalje preko 4MB, dodatno smanji kvalitet
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=55, optimize=True)
        data = buf.getvalue()
        return ("data:image/jpeg;base64," + base64.b64encode(data).decode("ascii"), "image/jpeg")
    except Exception as exc:  # noqa: BLE001
        print(f"[ui_design] cannot preprocess image: {exc}", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# MiniMax API call
# ---------------------------------------------------------------------------


def _call_MiniMax(base_url: str, model: str, api_key: str, image_data_uri: str) -> dict | None:
    """Pozovi ``POST {base_url}/chat/completions`` sa multimodal content.

    Vraća parsiran JSON dict iz ``choices[0].message.content`` ili ``None``
    ako poziv failuje. Timeout 60s za multimodal.
    """
    import httpx  # late import — scraper već ima httpx

    url = base_url.rstrip("/") + "/chat/completions"
    payload = {
        "model": model,
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": _PROMPT},
                    {"type": "image_url", "image_url": {"url": image_data_uri}},
                ],
            }
        ],
        "max_tokens": MAX_PROMPT_TOKENS,
        "temperature": 0.2,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
    }

    t0 = time.time()
    try:
        r = httpx.post(url, headers=headers, json=payload, timeout=TIMEOUT_SEC)
    except Exception as exc:  # noqa: BLE001
        print(f"[ui_design] MiniMax POST failed: {type(exc).__name__}: {str(exc)[:200]}", file=sys.stderr)
        return None

    duration_ms = int((time.time() - t0) * 1000)
    if r.status_code != 200:
        body_preview = r.text[:200].replace("\n", " ")
        print(
            f"[ui_design] MiniMax returned {r.status_code} in {duration_ms}ms: {body_preview}",
            file=sys.stderr,
        )
        return None

    try:
        data = r.json()
    except Exception:  # noqa: BLE001
        print(f"[ui_design] MiniMax returned non-JSON response", file=sys.stderr)
        return None

    try:
        content = data["choices"][0]["message"]["content"]
    except Exception:  # noqa: BLE001
        print("[ui_design] MiniMax response missing choices[0].message.content", file=sys.stderr)
        return None
    return _parse_content(content)


def _parse_content(content: str) -> dict | None:
    """Robusno parsira MiniMax M3 multimodal response.

    MiniMax M3 je reasoning model \u2014 vra\u0107e thinking/think blok PRE
    finalnog JSON-a, plus JSON mo\u017eee biti formatiran sa whitespace-om ili
    ise\u010den zbog max_tokens limita. Poku\u0161avamo:

    1. Ceo content kao \u010dist JSON
    2. Poslednji ``{...}`` blok (final answer, ignori\u0161e thinking)
    3. ``"score": <N>`` regex fallback (ako je JSON samo ise\u010den)

    Vra\u0107a ``None`` ako ni\u0161ta ne uspe, ili dict iz MiniMax response-a.
    """
    if not content:
        return None
    text = content.strip()

    # 1. Direktan JSON parse
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        pass

    # 2. Poslednji {...} blok (non-greedy, \u010distiji od greedy \u2014 izbegava
    # hvatanje nepotpunog razlomljenog thinking JSON-a).
    blocks = re.findall(r"\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}", text)
    if not blocks:
        # Fallback: greedy match
        blocks = re.findall(r"\{[\s\S]*?\}", text)
    for block in reversed(blocks):  # poslednji = final answer
        try:
            d = json.loads(block)
            if isinstance(d, dict) and ("score" in d or "summary" in d):
                return d
        except Exception:  # noqa: BLE001
            continue

    # 3. Regex fallback: izvuci score iz texta, ako JSON ise\u010den
    score_m = re.search(r'"score"\s*:\s*(\d{1,3})', text)
    summary_m = re.search(r'"summary"\s*:\s*"([^"]{1,500})"', text)
    issues_m = re.findall(r'"([^"]{10,200})"', text)
    if score_m:
        score = int(score_m.group(1))
        score = max(0, min(100, score))
        return {
            "score": score,
            "summary": summary_m.group(1) if summary_m else "",
            "issues": issues_m[:8] if issues_m else [],
            "_recovered_partial": True,
        }

    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def audit_ui_design(screenshot_path: str | None, base_url: str = "") -> dict:
    """Vrati audit dict za UI dizajn:

    {
        "score": int | None,     # 0-100, None ako skipped
        "weight": float,          # 0.05
        "issues": list[str],
        "summary": str,
        "skipped": bool,          # True ako MiniMax API nije pozvan
        "skip_reason": str,       # razlog preskakanja (za UI display)
        "raw": dict,              # sirovi API response za debug
    }
    """
    # Sanity: nema screenshot-a uopšte
    if not screenshot_path or not Path(screenshot_path).is_file():
        return {
            "score": None,
            "weight": WEIGHT,
            "issues": [],
            "summary": "",
            "skipped": True,
            "skip_reason": "Nema homepage screenshot-a za analizu.",
            "raw": {},
        }

    # Sanity: nema API key
    api_key = os.environ.get("MINIMAX_API_KEY", "").strip()
    if not api_key:
        return {
            "score": None,
            "weight": WEIGHT,
            "issues": [],
            "summary": "",
            "skipped": True,
            "skip_reason": (
                "MINIMAX_API_KEY nije postavljen u env. Dodaj ga u gui-astro/.env pa "
                "pokreni novi audit da bi UI ocena bila aktivna."
            ),
            "raw": {},
        }

    # Pripremi sliku
    prepared = _prepare_image_for_api(screenshot_path)
    if prepared is None:
        return {
            "score": None,
            "weight": WEIGHT,
            "issues": [],
            "summary": "",
            "skipped": True,
            "skip_reason": f"Screenshot ({Path(screenshot_path).name}) nije mogao da se obradi.",
            "raw": {},
        }
    data_uri, _mime = prepared

    # Pozovi MiniMax
    base_url_env = os.environ.get("MINIMAX_BASE_URL", "https://api.minimax.io/v1")
    model = os.environ.get("MINIMAX_MODEL", "MiniMax-M3")
    result = _call_MiniMax(base_url_env, model, api_key, data_uri)
    if result is None:
        return {
            "score": DEFAULT_SCORE,
            "weight": WEIGHT,
            "issues": [],
            "summary": "",
            "skipped": True,
            "skip_reason": "MiniMax API nije odgovorio (timeout, network, ili nevalidan API key).",
            "raw": {},
        }

    # Parsiranje. Ako result ima _raw_text=True → potpuni fail; tretiraj kao skip.
    # Ako ima _recovered_partial=True → JSON isečen ali score spašen, tretiraj kao
    # polovičan uspeh (skipped=False) da korisnik vidi makar score iz MiniMax-a.
    if result.get("_raw_text"):
        return {
            "score": DEFAULT_SCORE,
            "weight": WEIGHT,
            "issues": [],
            "summary": "",
            "skipped": True,
            "skip_reason": "MiniMax response nije čist JSON — prikaži raw.",
            "raw": {"_raw_text": result["_raw_text"][:1000]},
        }

    score_raw = result.get("score")
    try:
        score = int(score_raw)
        score = max(0, min(100, score))
    except Exception:  # noqa: BLE001
        score = DEFAULT_SCORE

    issues = result.get("issues") or []
    if isinstance(issues, str):
        # Ako MiniMax vrati issues kao jedan string, split po redovima
        issues = [s.strip() for s in re.split(r"[\n\u2022;]+", issues) if s.strip()][:8]

    summary = (result.get("summary") or "").strip()[:280]

    # Ako je parser morao da rekonstruiše iz isečenog JSON-a, dodaj note da
    # korisnik zna da nešto nije 100% kako treba (verovatno max_tokens limit).
    skip_note = ""
    if result.get("_recovered_partial"):
        skip_note = " (napomena: response je isečen iz reasoning output-a; max_tokens možda treba povećati)"

    return {
        "score": score,
        "weight": WEIGHT,
        "issues": list(issues)[:8],
        "summary": summary + skip_note,
        "skipped": False,
        "skip_reason": "",
        "raw": result,
    }
