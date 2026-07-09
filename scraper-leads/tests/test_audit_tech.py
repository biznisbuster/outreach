"""Tests for tech-stack detection."""

from __future__ import annotations

from maps_cold_calling.audit.tech import detect_in_html


WP_HTML = """
<!doctype html>
<html>
<head>
  <meta name="generator" content="WordPress 6.7.1">
  <link rel='stylesheet' href='/wp-content/themes/twentytwentyfour/style.css'>
  <script src='https://example.com/wp-includes/js/jquery/jquery.min.js?ver=3.7.1'></script>
  <script src='https://www.googletagmanager.com/gtag/js?id=G-XYZ'></script>
</head>
<body><h1>Hi</h1></body>
</html>
"""

WIX_HTML = """
<!doctype html>
<html>
<head>
  <link rel='stylesheet' href='https://static.wixstatic.com/sta-css/styles.css'>
  <script src='https://static.parastorage.com/_wix_browser.js'></script>
</head>
<body><h1>Wix Site</h1></body>
</html>
"""


def test_wordpress_detection():
    out = detect_in_html(WP_HTML)
    assert "wordpress" in out.tags
    assert "jquery" in out.tags
    assert "gtm" in out.tags
    assert out.has_generator_meta is not None
    assert "WordPress" in out.has_generator_meta


def test_wix_detection():
    out = detect_in_html(WIX_HTML)
    assert "wix" in out.tags


def test_garbage_input():
    out = detect_in_html(None)
    assert out.tags == []


def test_dedupe_tags():
    html = "<html><script src='jquery.js'></script><script src='jquery.min.js'></script></html>"
    out = detect_in_html(html)
    assert out.tags.count("jquery") == 1


def test_does_not_false_positive_against_html_charset():
    """Regression for a bug where 1-element needles like 'googletagmanager.com'
    were silently typed as strings, not tuples — iteration then matched the
    first character 'g' against any HTML.

    The point: an HTML page that contains only stub markup (no analytics,
    no Nuxt, no Tailwind) must not be labelled as those platforms.
    """
    plain = "<!doctype html><html lang=\"en\"><body><h1>Page</h1></body></html>"
    out = detect_in_html(plain)
    for tag in ("nuxt", "gtm", "nextjs", "tailwind", "google_analytics", "cloudflare"):
        assert tag not in out.tags, f"plain page falsely matched {tag!r}: {out.tags!r}"
