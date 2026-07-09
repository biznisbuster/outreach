/** POST /api/import — CSV/JSON preview (parse + validate + check dedup). */
import type { APIRoute } from "astro";
import { ok, bad } from "../../lib/api";
import { getDb, schema } from "../../lib/api";
import { normalizePhoneE164, normalizeWebsite, dedupKey } from "../../lib/dedup";
import { inArray } from "drizzle-orm";
import { parse } from "csv-parse/sync";

interface RawLead {
  name?: string;
  category?: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  postal_code?: string;
  google_rating?: number | string;
  reviews_count?: number | string;
  source?: string;
  source_url?: string;
}

function mapRow(raw: Record<string, string>): RawLead {
  const get = (...keys: string[]) => {
    for (const k of keys) {
      const found = Object.keys(raw).find((rk) => rk.trim().toLowerCase() === k.trim().toLowerCase());
      if (found && raw[found] !== undefined && raw[found] !== "") return raw[found];
    }
    return undefined;
  };
  return {
    name: get("naziv", "name", "ime", "business", "biznis"),
    category: get("kategorija", "category", "tip", "vrsta"),
    phone: get("telefon", "phone", "broj", "tel", "mobilni"),
    email: get("email", "e-mail", "mail", "eposta"),
    website: get("website", "sajt", "web", "url", "sajt_url", "web_sajt"),
    address: get("adresa", "address", "lokacija"),
    city: get("grad", "city", "mesto"),
    postal_code: get("postanski_broj", "postanski", "postal", "zip", "ptt"),
    google_rating: get("google_ocena", "ocena", "rating", "google_rating", "zvezdice"),
    reviews_count: get("broj_recenzija", "recenzije", "reviews", "broj_ocena"),
    source: get("izvor", "source", "poreklo"),
    source_url: get("izvor_url", "source_url", "link", "maps_url", "url_izvora"),
  };
}

function toNumber(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}

interface ParsedRow {
  normalized: {
    name: string;
    category: string | null;
    phoneRaw: string | null;
    phoneE164: string | null;
    email: string | null;
    websiteRaw: string | null;
    websiteNormalized: string | null;
    address: string | null;
    city: string | null;
    postalCode: string | null;
    googleRating: number | null;
    reviewsCount: number | null;
    source: string | null;
    sourceUrl: string | null;
    dedup: string;
  };
  errors: string[];
}

function parseRows(rawLeads: RawLead[]): { valid: ParsedRow[]; invalid: ParsedRow[] } {
  const rows: ParsedRow[] = rawLeads.map((raw) => {
    const errors: string[] = [];
    if (!raw.name || !raw.name.trim()) errors.push("naziv obavezan");
    if (!raw.city || !raw.city.trim()) errors.push("grad obavezan");
    const email = raw.email?.trim() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push("nevažeći email");

    const websiteNormalized = normalizeWebsite(raw.website);
    const phoneE164 = normalizePhoneE164(raw.phone);

    return {
      errors,
      normalized: {
        name: (raw.name || "").trim(),
        category: raw.category?.trim() || null,
        phoneRaw: raw.phone?.trim() || null,
        phoneE164,
        email,
        websiteRaw: raw.website?.trim() || null,
        websiteNormalized,
        address: raw.address?.trim() || null,
        city: raw.city?.trim() || null,
        postalCode: raw.postal_code?.trim() || null,
        googleRating: toNumber(raw.google_rating),
        reviewsCount: toNumber(raw.reviews_count),
        source: raw.source?.trim() || null,
        sourceUrl: raw.source_url?.trim() || null,
        dedup: dedupKey({ website: raw.website, phoneE164, name: raw.name, city: raw.city }),
      },
    };
  });
  return {
    valid: rows.filter((r) => r.errors.length === 0),
    invalid: rows.filter((r) => r.errors.length > 0),
  };
}

function parseInput(text: string): RawLead[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const json = JSON.parse(trimmed);
    const arr = Array.isArray(json) ? json : [json];
    return arr.map((o: Record<string, unknown>) => {
      const r: Record<string, string> = {};
      for (const [k, v] of Object.entries(o)) r[k] = v === null || v === undefined ? "" : String(v);
      return mapRow(r);
    });
  }
  const records = parse(trimmed, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true });
  return records.map((r: Record<string, string>) => mapRow(r));
}

export const POST: APIRoute = async ({ request }) => {
  const ct = request.headers.get("content-type") || "";
  let text: string;
  if (ct.includes("multipart/form-data")) {
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return bad("Nedostaje fajl (polje 'file').");
    text = await file.text();
  } else {
    text = await request.text();
  }

  let rawLeads: RawLead[];
  try {
    rawLeads = parseInput(text);
  } catch (e) {
    return bad(`Greška pri parsiranju: ${e instanceof Error ? e.message : String(e)}`);
  }

  const { valid, invalid } = parseRows(rawLeads);
  const db = getDb();
  const dedupKeys = valid.map((v) => v.normalized.dedup);
  const existing = db
    .select({ dedupKey: schema.leads.dedupKey })
    .from(schema.leads)
    .where(inArray(schema.leads.dedupKey, dedupKeys))
    .all();
  const existingSet = new Set(existing.map((e) => e.dedupKey));

  const newRows = valid.filter((v) => !existingSet.has(v.normalized.dedup));
  const dupRows = valid.filter((v) => existingSet.has(v.normalized.dedup));

  return ok({
    preview: true,
    total: rawLeads.length,
    newCount: newRows.length,
    duplicateCount: dupRows.length,
    invalidCount: invalid.length,
    newRows: newRows.map((r) => ({ ...r.normalized, errors: r.errors })),
    invalidRows: invalid.slice(0, 50).map((r, i) => ({
      index: i,
      name: r.normalized.name,
      city: r.normalized.city,
      errors: r.errors,
    })),
  });
};
