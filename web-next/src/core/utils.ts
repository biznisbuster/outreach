import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return new Intl.NumberFormat("sr-RS").format(n);
}

function toValidDate(d: Date | number | string | null | undefined): Date | null {
  if (d === null || d === undefined || d === "") return null;
  if (typeof d === "string") {
    const parsed = new Date(d);
    return isFinite(parsed.getTime()) ? parsed : null;
  }
  if (typeof d === "number") {
    if (!isFinite(d)) return null;
    const parsed = new Date(d);
    return isFinite(parsed.getTime()) ? parsed : null;
  }
  return isFinite(d.getTime()) ? d : null;
}

export function formatDate(d: Date | number | string | null | undefined): string {
  const date = toValidDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("sr-RS", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function shortDate(d: Date | number | string | null | undefined): string {
  const date = toValidDate(d);
  if (!date) return "—";
  return new Intl.DateTimeFormat("sr-RS", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

export function timeAgo(d: Date | number | string | null | undefined): string {
  const date = toValidDate(d);
  if (!date) return "nikad";
  const diff = Date.now() - date.getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return "sada";
  if (min < 60) return `pre ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `pre ${h} č`;
  const days = Math.floor(h / 24);
  if (days < 30) return `pre ${days} d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `pre ${months} mes`;
  return `pre ${Math.floor(months / 12)} god`;
}

// Alias za timeAgo (semantički jasnije za datume u budućnosti ako treba)
export const relativeTime = timeAgo;

/** Build querystring od objekta, izbacuje null/undefined. */
export function qs(params: Record<string, unknown>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined || v === "") continue;
    u.set(k, String(v));
  }
  const s = u.toString();
  return s ? `?${s}` : "";
}

/** Formatiraj telefon za prikaz. Ako je E.164 (+381...), lepše formatiranje.
 *  Primeri:
 *    "+38162375687"     → "+381 62 375 687"
 *    "018521682"        → "018 521 682"
 *    "+381 11 123 4567" → "+381 11 123 4567" (već formatiran)
 */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const s = String(raw).trim();
  // Ako je E.164 (+XXX...), formatiraj XXX XXX XXXX
  const e164 = s.match(/^\+?(\d{1,4})(\d{2,4})(\d{3,4})(\d{3,4})$/);
  if (e164) {
    return "+" + e164[1] + " " + [e164[2], e164[3], e164[4]].filter(Boolean).join(" ");
  }
  // Ako sadrži razmake/ crte, vrati kako jeste (lepo formatiran ulaz)
  if (/[\s\-/()]/.test(s)) return s;
  // Ako je kratak broj (npr. 0641234567), formatiraj kao 064 123 4567
  const local = s.replace(/\D/g, "");
  if (local.length >= 8 && local.length <= 12) {
    if (local.startsWith("0")) {
      // 0XX XXX XXXX (10 cifara) ili 0XX XXX XXX (9 cifara)
      if (local.length === 10) return `${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`;
      if (local.length === 9) return `${local.slice(0, 2)} ${local.slice(2, 5)} ${local.slice(5)}`;
    }
    return local;
  }
  return s;
}

/** Incijali za avatar (npr. "Cvećara Niš" → "CN"). Srpska slova se normalizuju. */
export function getInitials(name: string | null | undefined): string {
  if (!name) return "?";
  const cleaned = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // skini dijakritike
    .replace(/[^A-Za-z0-9 ]/g, " ")   // zameni specijalne karaktere razmakom
    .trim();
  const words = cleaned.split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}
