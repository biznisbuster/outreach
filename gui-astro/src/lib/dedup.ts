import { createHash } from "node:crypto";

/**
 * Normalizacija website-a: lowercase, bez protokola, bez www, bez krajnjeg /.
 * "https://www.Example.rs/O-nama/" → "example.rs"
 */
export function normalizeWebsite(raw?: string | null): string | null {
  if (!raw) return null;
  let s = raw.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  s = s.replace(/^www\./, "");
  // skini path/query/fragment
  s = s.split("/")[0].split("?")[0].split("#")[0];
  s = s.replace(/\/+$/, "");
  return s || null;
}

/**
 * Društvene mreže i slični "nema-pravi-sajt" domeni. Google Maps često vrati
 * instagram.com ili facebook.com profil kao "website" biznisa. Takav domen NIJE
 * jedinstven identifikator biznisa (hiljade teretana deli instagram.com), pa se
 * ne sme koristiti kao dedup ključ po website-u — pada na telefon/ime+grad.
 *
 * "m.facebook.com" se normalizuje u "m.facebook.com" (zadržava subdomain), pa
 * proveravamo i root domen (facebook.com) nakon skidanja prvog segmenta.
 */
const SOCIAL_DOMAINS = new Set([
  "instagram.com",
  "facebook.com",
  "m.facebook.com",
  "fb.com",
  "tiktok.com",
  "youtube.com",
  "youtu.be",
  "twitter.com",
  "x.com",
  "vk.com",
  "plus.google.com",
  "maps.google.com",
]);

/** Da li je normalizovani domen društvena mreža (ne sme biti dedup ključ)? */
export function isSocialDomain(normalized?: string | null): boolean {
  if (!normalized) return false;
  if (SOCIAL_DOMAINS.has(normalized)) return true;
  // Skini prvi segment (npr. "m.facebook.com" → "facebook.com") i probaj opet.
  const parts = normalized.split(".");
  if (parts.length > 2) {
    const root = parts.slice(1).join(".");
    if (SOCIAL_DOMAINS.has(root)) return true;
  }
  return false;
}

/** Vraća puni URL sa protokolom za prikaz/scrape. */
export function fullWebsite(normalized?: string | null): string | null {
  if (!normalized) return null;
  return `https://${normalized}`;
}

/**
 * Normalizacija srpskog telefona u E.164 (+381…).
 * "064/123-4567", "+381 64 123 4567", "00381641234567" → "+381641234567"
 */
export function normalizePhoneE164(raw?: string | null): string | null {
  if (!raw) return null;
  let d = raw.replace(/[^\d+]/g, "");
  if (!d) return null;

  if (d.startsWith("+")) {
    d = d.slice(1);
  } else if (d.startsWith("00")) {
    d = d.slice(2);
  } else if (d.startsWith("381")) {
    // vec internacional bez +
  } else if (d.startsWith("0")) {
    // lokalni sa vodećom nulom → zameni sa 381
    d = "381" + d.slice(1);
  } else if (d.length === 8 || d.length === 9) {
    // verovatno fiksni/bez nule
    d = "381" + d;
  } else {
    return null;
  }

  if (d.startsWith("381") && d.length >= 10 && d.length <= 13) {
    return "+" + d;
  }
  // strani brojevi
  if (d.length >= 8 && d.length <= 15) {
    return "+" + d;
  }
  return null;
}

/**
 * Dedup ključ po prioritetu:
 * 1) website_normalized (ali NE za social domene — instagram.com dele hiljade biznisa)
 * 2) phone_e164
 * 3) hash(name+city)
 */
export function dedupKey(p: {
  website?: string | null;
  phoneE164?: string | null;
  name?: string | null;
  city?: string | null;
}): string {
  const website = normalizeWebsite(p.website);
  if (website && !isSocialDomain(website)) return `w:${website}`;
  if (p.phoneE164) return `p:${p.phoneE164}`;
  const base = `${(p.name || "").trim().toLowerCase()}|${(p.city || "").trim().toLowerCase()}`;
  return "n:" + createHash("sha1").update(base).digest("hex").slice(0, 16);
}
