"""Quick smoke test of email extraction logic."""
from maps_cold_calling.scraper.email import _extract_from_text
assert _extract_from_text('<a href="mailto:foo@bar.com">x</a>') == 'foo@bar.com'
assert _extract_from_text('Contact us at info[at]example[dot]com today') == 'info@example.com'
assert _extract_from_text('purchasing (at) google (dot) com') == 'purchasing@google.com'
assert _extract_from_text('Drop us a note: name&#64;domain&#46;com') == 'name@domain.com'
assert _extract_from_text('Plain at hello@hello.org') == 'hello@hello.org'
assert _extract_from_text('no email here') is None
print('text-based extraction: PASS')
