"""Kategorizacija stranica na osnovu URL-a i sadržaja."""
import re
from urllib.parse import urlparse


def categorize_page(url: str, title: str | None = None, h1: str | None = None) -> str:
    path = urlparse(url).path.lower().rstrip("/")
    # Home
    if path == "" or path == "/":
        return "Home"

    # Blog / postovi
    if re.search(r"/(blog|vesti|vijesti|news|clanak|clanci)/", path):
        return "Posts"
    if re.search(r"/\d{4}/", path) or re.search(r"/post/", path):
        return "Posts"

    # Proizvodi
    if re.search(r"/(proizvod|product|prodaja|shop|store)/", path) or path.endswith("/shop") or path.endswith("/prodaja"):
        return "Products"

    # Portfolio / galerija
    if re.search(r"/(portfolio|galerija|radovi|usluge|reference|projects)/", path):
        return "Portfolio"

    # Usluge / kategorije
    if re.search(r"/(usluge|service|kategorija|category|kategorije)/", path):
        return "Categories"

    # Kontakt / o nama
    if re.search(r"/(kontakt|contact|o-nama|about)/", path):
        return "Pages"

    return "Other"


def filter_pages(urls: list[str], max_pages: int) -> list[str]:
    """Filtrira nepotrebne URL-ove (paginacija, fajlovi) i prioritizuje važne."""
    seen = set()
    result: list[str] = []
    for url in urls:
        p = urlparse(url).path.lower()
        # preskoči fajlove
        if re.search(r"\.(jpg|jpeg|png|gif|pdf|css|js|ico|svg|webp|zip|docx?)$", p):
            continue
        # preskoči paginaciju
        if re.search(r"/page/\d+", p) or "page=" in url.lower():
            continue
        if url in seen:
            continue
        seen.add(url)
        result.append(url)
        if len(result) >= max_pages:
            break
    return result
