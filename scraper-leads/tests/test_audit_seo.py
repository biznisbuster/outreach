"""Tests for the pure-HTML SEO extractor (no network)."""

from __future__ import annotations

from maps_cold_calling.audit.seo import parse_html


HTML_BASIC = """<!doctype html>
<html lang="sr">
<head>
  <title>  Frizerski Studio Fantastiko – Kruševac  </title>
  <meta name="description" content="Najbolji frizerski salon u Kruševcu. Profesionalni frizeri.">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="canonical" href="https://frizerski-fantastiko.rs/">
  <meta property="og:title" content="Frizerski Fantastiko">
  <meta property="og:description" content="Dobrodošli u naš salon.">
</head>
<body>
  <h1>Frizerski Studio Fantastiko</h1>
  <h2>Naše usluge</h2>
  <h2>Cenovnik</h2>
  <h2>Kontakt</h2>
  <p>Dobrodošli u naš salon! Pružamo sve vrste frizerskih usluga za dame i gospodu.</p>
  <a href="/cenovnik">Cenovnik</a>
  <a href="/kontakt">Kontakt</a>
  <a href="https://facebook.com/fantastiko">Facebook</a>
  <img src="/img1.jpg" alt="Izlog salona">
  <img src="/img2.jpg" alt="">
  <img src="/img3.jpg">
</body>
</html>
"""


HTML_THIN = """<!doctype html>
<html>
<head><title>Tiny</title></head>
<body>hi</body>
</html>
"""


def test_basic_seo_extraction():
    out = parse_html(HTML_BASIC, base_url="https://frizerski-fantastiko.rs/")
    assert out.title == "Frizerski Studio Fantastiko – Kruševac"
    assert out.meta_description is not None and "frizerski" in out.meta_description.lower()
    assert out.h1 == "Frizerski Studio Fantastiko"
    assert out.h2_count == 3
    assert out.lang == "sr"
    assert out.canonical == "https://frizerski-fantastiko.rs/"
    assert out.og_title == "Frizerski Fantastiko"
    assert out.has_viewport is True
    assert out.image_count == 3
    assert out.images_with_alt == 1  # 1 with alt, 1 empty, 1 missing
    assert out.internal_links >= 2
    assert out.external_links >= 1
    assert out.word_count > 10
    assert out.body_excerpt is not None
    assert out.text_summary and "Naše usluge" in out.text_summary


def test_thin_html_safe_defaults():
    out = parse_html(HTML_THIN, base_url="https://example.com")
    assert out.title == "Tiny"
    assert out.h1 is None
    assert out.h2_count == 0
    assert out.image_count == 0
    assert out.word_count <= 5
    assert out.text_summary == ""


def test_empty_input():
    out = parse_html(None)
    assert out.title is None
    assert out.word_count == 0


def test_garbage_input_does_not_crash():
    out = parse_html("<<<not html>>>", base_url="https://example.com")
    # Whatever happens, no exception
    assert isinstance(out.title, type(None)) or isinstance(out.title, str)
