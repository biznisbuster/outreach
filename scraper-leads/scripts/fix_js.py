"""Quick fix for the JS eval in maps_search.py."""
from pathlib import Path

p = Path("src/maps_cold_calling/scraper/maps_search.py")
text = p.read_text()
old = text.split("\n")[121]  # 0-indexed
print("OLD:", repr(old[:80]))
new = '            \'els => els.map(el => { let card = el.parentElement; while (card && card.innerText.length < 80) card = card.parentElement; return { href: el.href, text: card ? (card.innerText||"").replace(/\\s+/g," ").trim() : "" }; })\','
text = text.replace(old, new, 1)
p.write_text(text)
print("replaced")
