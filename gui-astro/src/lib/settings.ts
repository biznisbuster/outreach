/**
 * Centralni runtime settings.
 *
 * DB (settings.key/value) → env → hardcoded default.
 * Secrets (api_key, password) enkriptuju se pre upisa koristeći
 * `lib/crypto.ts` (isti AES-256-GCM kao za SMTP šifre).
 *
 * Keširanje: 1 sekunda u memoriji, da ne udaramo SQLite na svaki poziv.
 *
 * UI: `pages/settings.astro` renderuje jednu karticu po grupi (redosled
 * dole), sa anchor navigacijom u sidebar-u. Svaka grupa ima `groupDescription`
 * koji objašnjava šta ova sekcija kontroliše.
 */
import { getDb, schema } from "./db";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "./crypto";

export interface SettingDef {
  key: string;
  defaultValue: string;
  isSecret?: boolean;
  group: string; // UI sekcija (slug)
  groupTitle: string; // UI naslov
  groupDescription: string; // UI opis cele sekcije
  label: string; // input label
  description?: string; // detaljni opis polja
  placeholder?: string;
  type: "text" | "password" | "number" | "select" | "boolean";
  options?: string[];
  envHint?: string; // koja env var se koristi kao fallback
  unit?: string; // prikaz u UI (npr. "ms", "s", "dana", "%")
  min?: number;
  max?: number;
}

export const SETTINGS_CATALOG: Record<string, SettingDef> = {
  // ─── Slanje emaila ─────────────────────────────────────────────────────
  // Kontroliše kad i koliko sme da se šalje. Sve vrednosti se čitaju
  // iz DB (ili env/default fallback) u scheduler tick-u — bez restarta.
  send_window_start: {
    key: "send_window_start",
    defaultValue: "09:00",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription:
      "Prozor slanja, podrazumevani cap-ovi za nove sendere i delay između dva maila. Scheduler poštuje ove vrednosti na svakom tick-u.",
    label: "Početak prozora (HH:MM)",
    description:
      "Od kog sata scheduler sme da pošalje prvi email. Format 24h (HH:MM). " +
      "Vreme se računa u zoni iz 'Vremenska zona'. Ne zavisi od vremena primaoca.",
    type: "text",
    envHint: "SEND_WINDOW_START",
  },
  send_window_end: {
    key: "send_window_end",
    defaultValue: "17:00",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Kraj prozora (HH:MM)",
    description: "Do kog sata scheduler sme da šalje (ne uključujući). Npr. 17:00 znači poslednji email može u 16:59.",
    type: "text",
    envHint: "SEND_WINDOW_END",
  },
  send_window_tz: {
    key: "send_window_tz",
    defaultValue: "Europe/Belgrade",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Vremenska zona prozora",
    description:
      "IANA TZ naziv. Početak/kraj prozora se tumače u ovoj zoni. " +
      "Promena utiče samo na buduće tick-ove, ne na već zakazane emailove.",
    type: "text",
    placeholder: "Europe/Belgrade",
    envHint: "SEND_WINDOW_TZ",
  },
  send_window_days: {
    key: "send_window_days",
    defaultValue: "mon-fri",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Dani slanja",
    description:
      "Dozvoljeni dani za slanje. Format: 'mon-fri' (opseg) ili 'mon,wed,fri' (lista dana). " +
      "Scheduler preskače tick-ove van ovih dana.",
    type: "text",
    placeholder: "mon-fri",
    envHint: "SEND_WINDOW_DAYS",
  },
  default_sender_hourly_cap: {
    key: "default_sender_hourly_cap",
    defaultValue: "10",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Podrazumevani hourly cap (po senderu)",
    description:
      "Koliko emailova NOVI sender sme da pošalje na sat. " +
      "Postojeći senderi imaju svoju vrednost u tabeli senders (vidi /senders).",
    type: "number",
    envHint: "DEFAULT_SENDER_HOURLY_CAP",
    unit: "email/sat",
    min: 1,
    max: 200,
  },
  default_sender_daily_cap: {
    key: "default_sender_daily_cap",
    defaultValue: "50",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Podrazumevani daily cap (po senderu)",
    description:
      "Koliko emailova NOVI sender sme da pošalje dnevno. " +
      "Postojeći senderi imaju svoju vrednost u tabeli senders.",
    type: "number",
    envHint: "DEFAULT_SENDER_DAILY_CAP",
    unit: "email/dan",
    min: 1,
    max: 1000,
  },
  default_min_delay_sec: {
    key: "default_min_delay_sec",
    defaultValue: "30",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Default min delay između dva maila",
    description:
      "Minimalna pauza (u sekundama) posle svakog poslatog emaila. " +
      "Koristi se za random delay u opsegu [min, max] pri pickNextSender. " +
      "Važi za nove sendere; postojeći imaju per-red vrednost.",
    type: "number",
    unit: "s",
    min: 0,
    max: 3600,
  },
  default_max_delay_sec: {
    key: "default_max_delay_sec",
    defaultValue: "120",
    group: "email-sending",
    groupTitle: "Slanje emaila",
    groupDescription: "",
    label: "Default max delay između dva maila",
    description:
      "Maksimalna pauza (u sekundama) posle svakog poslatog emaila. " +
      "Ako je <= min_delay, delay je fiksan na tu vrednost.",
    type: "number",
    unit: "s",
    min: 0,
    max: 3600,
  },

  // ─── Bounce guard ──────────────────────────────────────────────────────
  // Ako je nedavni bounce rate iznad praga, scheduler automatski pauzira
  // SVE sendere. Ovo je zaštita od banovanja domena.
  bounce_threshold_pct: {
    key: "bounce_threshold_pct",
    defaultValue: "5",
    group: "bounce-guard",
    groupTitle: "Bounce guard",
    groupDescription:
      "Zaštita od visokog bounce rate-a. Ako nedavni procenat bouncovanih emailova pređe prag, scheduler pauzira SVE aktivne sendere dok ručno ne omogućiš.",
    label: "Bounce prag",
    description:
      "Maksimalni dozvoljeni bounce rate (u procentima). " +
      "Ako recentBounceRate() premaši ovaj procenat, scheduler postavlja active=false na svim senderima i preskače sve poslate emailove.",
    type: "number",
    unit: "%",
    min: 0,
    max: 100,
  },
  bounce_window_days: {
    key: "bounce_window_days",
    defaultValue: "7",
    group: "bounce-guard",
    groupTitle: "Bounce guard",
    groupDescription: "",
    label: "Prozor za bounce rate",
    description:
      "Koliko dana unazad gledamo bounce-ovane emailove. " +
      "Stariji bounci se ignorišu.",
    type: "number",
    unit: "dana",
    min: 1,
    max: 90,
  },
  bounce_sample_size: {
    key: "bounce_sample_size",
    defaultValue: "50",
    group: "bounce-guard",
    groupTitle: "Bounce guard",
    groupDescription: "",
    label: "Sample size za bounce rate",
    description:
      "Koliko poslednjih slanja (sent + bounced) koristimo za izračunavanje rate-a. " +
      "Manji sample je osetljiviji na spike-ove, veći je stabilniji ali sporiji za reakciju.",
    type: "number",
    unit: "emailova",
    min: 10,
    max: 500,
  },

  // ─── Scheduler ─────────────────────────────────────────────────────────
  // Interni tick koji vrti queue + IMAP poll. Isključivanje zaustavlja
  // celokupan automatski rad (slanje + reply tracking), ali ne dirа UI.
  scheduler_enabled: {
    key: "scheduler_enabled",
    defaultValue: "1",
    group: "scheduler",
    groupTitle: "Scheduler",
    groupDescription:
      "Interni cron-like radnik koji u pozadini šalje emailove i poll-uje IMAP. Zaustavljanje schedulera NE utiče na UI — samo na automatske akcije.",
    label: "Aktivan scheduler",
    description:
      "Master prekidač. 1 = startuje se pri startu servera, 0 = ne poziva se processQueue() ni IMAP poll. " +
      "Restart servera je potreban da promena stupila na snagu (čita se u instrumentation hook-u).",
    type: "boolean",
  },
  scheduler_tick_ms: {
    key: "scheduler_tick_ms",
    defaultValue: "60000",
    group: "scheduler",
    groupTitle: "Scheduler",
    groupDescription: "",
    label: "Interval između dva tick-a",
    description:
      "Koliko ms scheduler čeka između dva prolaza kroz queue. " +
      "Manje = brža reakcija, više = manje SQLite upita. " +
      "Restart servera da promena važi.",
    type: "number",
    unit: "ms",
    min: 1000,
    max: 600000,
  },
  scheduler_batch_size: {
    key: "scheduler_batch_size",
    defaultValue: "20",
    group: "scheduler",
    groupTitle: "Scheduler",
    groupDescription: "",
    label: "Emailova po tick-u",
    description:
      "Maksimalan broj emailova koji scheduler obrađuje u jednom prolazu. " +
      "Ostatak čeka sledeći tick. Smanji ako imaš rate-limit probleme sa SMTP-om.",
    type: "number",
    unit: "emailova",
    min: 1,
    max: 200,
  },

  // ─── Scraper servisi ───────────────────────────────────────────────────
  // URL-ovi ka Python scraper servisima. Default-i su za Docker compose
  // mrežu (scraper:8001, scraper-leads:8002). Za lokalni dev prebaci na
  // 127.0.0.1.
  scraper_url: {
    key: "scraper_url",
    defaultValue: "http://scraper:8001",
    group: "scraper",
    groupTitle: "Scraper servisi",
    groupDescription:
      "URL-ovi ka Python scraper kontejnerima i scrape parametri. Auto-screenshot je client-side toggle koji automatski pokreće scrape pri otvaranju leada.",
    label: "Lead scraper URL (page-by-page crawl)",
    description:
      "Stari scraper servis. Crawl-uje sajt jednog lead-a (sitemap + kategorije + članci). " +
      "Vraća screenshot + SEO metriku po stranici.",
    type: "text",
    placeholder: "http://scraper:8001",
    envHint: "SCRAPER_URL",
  },
  scraper_leads_url: {
    key: "scraper_leads_url",
    defaultValue: "http://scraper-leads:8002",
    group: "scraper",
    groupTitle: "Scraper servisi",
    groupDescription: "",
    label: "Scrape-leads URL (Google Maps)",
    description:
      "maps-cold-calling FastAPI wrapper. Pokreće Google Maps pretragu po (kategorija, grad). " +
      "Vraća CSV + progress events.",
    type: "text",
    placeholder: "http://scraper-leads:8002",
    envHint: "SCRAPER_LEADS_URL",
  },
  scraper_max_pages: {
    key: "scraper_max_pages",
    defaultValue: "20",
    group: "scraper",
    groupTitle: "Scraper servisi",
    groupDescription: "",
    label: "Max strana po scrape-u (page crawler)",
    description:
      "Gornja granica za koliko stranica jednog sajta scraper može da crawluje. " +
      "Više = detaljnija M3 analiza ali duže traje. " +
      "Preporuka: 10-30 za većinu sajtova.",
    type: "number",
    unit: "strana",
    min: 1,
    max: 100,
  },
  auto_screenshot_on_open: {
    key: "auto_screenshot_on_open",
    defaultValue: "0",
    group: "scraper",
    groupTitle: "Scraper servisi",
    groupDescription: "",
    label: "Auto-screenshot pri otvaranju leada",
    description:
      "Ako je uključeno (1), otvaranje lead detail stranice automatski pokreće scrape ako lead nema screenshot. " +
      "Preporuka: 0 — radi scrape ručno da ne blokiraš UI.",
    type: "select",
    options: ["0", "1"],
  },

  // ─── IMAP (reply tracking) ─────────────────────────────────────────────
  // Poll-uje INBOX i match-uje reply-je na osnovu (a) from-email = lead.email
  // ili (b) In-Reply-To header = message_id poslatog emaila.
  imap_host: {
    key: "imap_host",
    defaultValue: "",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription:
      "Poll-uje INBOX i automatski detektuje reply-je. Kad reply stigne, lead dobija status 'Odgovorio' i sve queued emailove za tog leada se stopiraju.",
    label: "IMAP host",
    description: "Npr. imap.gmail.com, imap.zoho.com, mail.tvojdomen.rs.",
    type: "text",
    placeholder: "imap.gmail.com",
    envHint: "IMAP_HOST",
  },
  imap_port: {
    key: "imap_port",
    defaultValue: "993",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "Port",
    description: "Standard 993 za IMAPS (SSL). 143 samo ako nema TLS-a.",
    type: "number",
    envHint: "IMAP_PORT",
    min: 1,
    max: 65535,
  },
  imap_secure: {
    key: "imap_secure",
    defaultValue: "1",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "SSL/TLS",
    description:
      "Koristi SSL/TLS konekciju (port obično 993). " +
      "Isključi (0) samo za nestandardne setup-ove sa STARTTLS na portu 143.",
    type: "boolean",
  },
  imap_user: {
    key: "imap_user",
    defaultValue: "",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "Korisničko ime",
    description: "Obično puna email adresa (npr. tvojalias@tvojdomen.rs).",
    type: "text",
    placeholder: "alias@tvojdomen.rs",
    envHint: "IMAP_USER",
  },
  imap_password: {
    key: "imap_password",
    defaultValue: "",
    isSecret: true,
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "Lozinka (app password)",
    description:
      "Ako koristiš Gmail sa 2FA, generiši App Password na " +
      "https://myaccount.google.com/apppasswords. Čuva se enkriptovano (AES-256-GCM).",
    type: "password",
    envHint: "IMAP_PASSWORD",
  },
  imap_folder: {
    key: "imap_folder",
    defaultValue: "INBOX",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "Folder",
    description: "Obično INBOX. Može i 'INBOX/Outreach' ako imaš filter na alias.",
    type: "text",
    placeholder: "INBOX",
    envHint: "IMAP_FOLDER",
  },
  imap_poll_minutes: {
    key: "imap_poll_minutes",
    defaultValue: "5",
    group: "imap",
    groupTitle: "IMAP (reply tracking)",
    groupDescription: "",
    label: "Interval pollanja (min)",
    description:
      "Koliko često scheduler proverava INBOX. " +
      "Manje = brže detektuje reply, više = manje IMAP konekcija. " +
      "5 min je razuman default.",
    type: "number",
    unit: "min",
    envHint: "IMAP_POLL_MINUTES",
    min: 1,
    max: 1440,
  },

  // ─── Dashboard "Za zvanje danas" ───────────────────────────────────────
  // Dva heuristika: (a) sent u prozoru bez reply-ja = follow-up due,
  // (b) aktivan lead bez kontakta u prozoru = treba zvati.
  dashboard_followup_window_days: {
    key: "dashboard_followup_window_days",
    defaultValue: "7",
    group: "dashboard",
    groupTitle: 'Dashboard "Za zvanje danas"',
    groupDescription:
      'Parametri za widget "Za zvanje danas" na dashboard-u. Dva pravila: lead kome je poslat email pre X dana bez reply-ja (follow-up due), i aktivan lead bez kontakta u poslednjih Y dana (bez kontakta).',
    label: "Follow-up prozor",
    description:
      "Koliko dana unazad gledamo sent emailove da bismo detektovali follow-up due. " +
      "Sent stariji od ovog prozora se ignoriše.",
    type: "number",
    unit: "dana",
    min: 1,
    max: 90,
  },
  dashboard_followup_min_age_days: {
    key: "dashboard_followup_min_age_days",
    defaultValue: "3",
    group: "dashboard",
    groupTitle: 'Dashboard "Za zvanje danas"',
    groupDescription: "",
    label: "Min starost sent emaila za follow-up",
    description:
      "Sent email mora biti stariji od ovog broja dana da bi follow-up imao smisla " +
      "(da damo primaocu vremena da odgovori).",
    type: "number",
    unit: "dana",
    min: 1,
    max: 30,
  },
  dashboard_no_contact_days: {
    key: "dashboard_no_contact_days",
    defaultValue: "5",
    group: "dashboard",
    groupTitle: 'Dashboard "Za zvanje danas"',
    groupDescription: "",
    label: "Bez kontakta (dana)",
    description:
      "Ako aktivan lead nema email_send ni komentar u poslednjih X dana, " +
      "pojavljuje se u todo listi sa reason='no_contact'.",
    type: "number",
    unit: "dana",
    min: 1,
    max: 90,
  },
  dashboard_call_todo_limit: {
    key: "dashboard_call_todo_limit",
    defaultValue: "20",
    group: "dashboard",
    groupTitle: 'Dashboard "Za zvanje danas"',
    groupDescription: "",
    label: "Max stavki u todo listi",
    description:
      "Koliko leadova se prikazuje u widgetu. Ako ima više, korisnik može " +
      "filtrirati po statusu/gradu na /leads.",
    type: "number",
    unit: "stavki",
    min: 5,
    max: 100,
  },

  // ─── Unsubscribe ───────────────────────────────────────────────────────
  unsubscribe_base_url: {
    key: "unsubscribe_base_url",
    defaultValue: "",
    group: "unsubscribe",
    groupTitle: "Unsubscribe",
    groupDescription:
      "Konfiguracija unsubscribe linka koji se dodaje na kraj svakog poslatog emaila. HMAC token bez auth — primaoc može jednim klikom da se odjavi.",
    label: "Unsubscribe base URL",
    description:
      "Bazni URL bez trailing slash-a. Link će biti " +
      "<base>/api/unsubscribe?id=<send_id>&token=<hmac>. " +
      "Mora biti javno dostupan primaocima (https://...).",
    type: "text",
    placeholder: "https://outreach.tvojdomen.rs",
    envHint: "UNSUBSCRIBE_BASE_URL",
  },

  // ─── Email attachments ────────────────────────────────────────────────
  // Šalju se kao MIME multipart nodemailer-om. Storage: ~/outreach-data/attachments/.
  // Validacija: MIME tip mora biti u attachment_allowed_mime, size <= attachment_max_size_mb.
  attachment_max_size_mb: {
    key: "attachment_max_size_mb",
    defaultValue: "10",
    group: "email-attachments",
    groupTitle: "Email attachments",
    groupDescription:
      "Email attachment-i (PDF ponude, slike). Fajlovi se čuvaju u ~/outreach-data/attachments/ van repo-a. Validacija se radi pre svakog upload-a.",
    label: "Max veličina po attachment-u",
    description:
      "Maksimalna dozvoljena veličina jednog fajla u MB. Veći fajlovi se odbijaju sa 400 greškom pri upload-u. " +
      "Preporuka: 10MB (Gmail limit je 25MB ukupno sa encoding headroom-om).",
    type: "number",
    unit: "MB",
    min: 1,
    max: 50,
  },
  attachment_allowed_mime: {
    key: "attachment_allowed_mime",
    defaultValue: "application/pdf,image/jpeg,image/png,image/webp",
    group: "email-attachments",
    groupTitle: "Email attachments",
    groupDescription: "",
    label: "Dozvoljeni MIME tipovi",
    description:
      "Comma-separated lista MIME tipova koji se prihvataju pri upload-u. " +
      "Ostali tipovi se odbijaju sa 400. Preporuka: PDF + slike za B2B ponude.",
    type: "text",
    placeholder: "application/pdf,image/jpeg,image/png,image/webp",
  },
};

type CacheEntry = { value: string; ts: number };
const _cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 1000;

function _readDB(key: string): string | undefined {
  const db = getDb();
  const [row] = db.select().from(schema.settings).where(eq(schema.settings.key, key)).all();
  if (!row?.value) return undefined;
  const def = SETTINGS_CATALOG[key];
  try {
    if (def?.isSecret && row.value.startsWith("v1:")) return decrypt(row.value);
  } catch {
    // vrednost nije šifrovana (možda legacy plaintext), vrati kako jeste
  }
  return row.value;
}

function _envFallback(key: string): string | undefined {
  const def = SETTINGS_CATALOG[key];
  if (!def?.envHint) return undefined;
  const v = process.env[def.envHint];
  return v && !v.startsWith("replace") ? v : undefined;
}

/**
 * Čita setting. Redosled: in-memory cache (1s) → DB → env → default.
 */
export function getSetting(key: string): string {
  const def = SETTINGS_CATALOG[key];
  if (!def) {
    // Nepoznat ključ — vrati iz DB/env ako postoji, inače prazan string
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;
    const dbVal = _readDB(key);
    if (dbVal !== undefined) {
      _cache.set(key, { value: dbVal, ts: Date.now() });
      return dbVal;
    }
    return process.env[key.toUpperCase()] ?? "";
  }

  const cached = _cache.get(key);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.value;

  const dbVal = _readDB(key);
  if (dbVal !== undefined && dbVal !== "") {
    _cache.set(key, { value: dbVal, ts: Date.now() });
    return dbVal;
  }
  const envVal = _envFallback(key);
  if (envVal !== undefined && envVal !== "") {
    _cache.set(key, { value: envVal, ts: Date.now() });
    return envVal;
  }
  _cache.set(key, { value: def.defaultValue, ts: Date.now() });
  return def.defaultValue;
}

/** Čita setting kao broj. */
export function getSettingInt(key: string): number {
  const n = Number(getSetting(key));
  return Number.isFinite(n) ? n : 0;
}

/** Čita setting kao boolean (1/0, true/false). */
export function getSettingBool(key: string): boolean {
  const v = getSetting(key);
  return v === "1" || v.toLowerCase() === "true";
}

/** Čita secret setting — placeholder ako nije podešen. */
export function getSettingOrEmpty(key: string): string {
  return getSetting(key);
}

/**
 * Upisuje setting. Ako je `isSecret=true`, enkriptuje pre upisa.
 * Briše cache za dati ključ.
 */
export function setSetting(key: string, value: string, isSecret = false): void {
  const db = getDb();
  const stored = isSecret && value ? encrypt(value) : value;
  // UPSERT — Drizzle nema native ON CONFLICT u sqlite-core, koristimo replace
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).all();
  if (existing.length > 0) {
    db.update(schema.settings).set({ value: stored }).where(eq(schema.settings.key, key)).run();
  } else {
    db.insert(schema.settings).values({ key, value: stored }).run();
  }
  _cache.delete(key);
}

/** Briše setting iz DB (sledeći getSetting čita env/default). */
export function clearSetting(key: string): void {
  const db = getDb();
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
  _cache.delete(key);
}

/** Vraća sve setting-e za UI (sa indikatorom izvora). */
export interface SettingView {
  key: string;
  value: string;
  isSecret: boolean;
  isSet: boolean; // != default
  source: "db" | "env" | "default";
  def: SettingDef;
}

export function getAllSettings(): SettingView[] {
  const db = getDb();
  const dbRows = new Map(
    db.select().from(schema.settings).all().map((r) => [r.key, r.value ?? ""]),
  );
  return Object.values(SETTINGS_CATALOG).map((def) => {
    let value = "";
    let source: "db" | "env" | "default" = "default";
    let displayValue = "";
    if (dbRows.has(def.key)) {
      const raw = dbRows.get(def.key)!;
      try {
        displayValue = def.isSecret && raw.startsWith("v1:") ? decrypt(raw) : raw;
      } catch {
        displayValue = raw;
      }
      source = "db";
      // Za secret polja vraćamo dekriptovanu vrednost da UI može da zadrži draft
      // (input type=password + Reveal dugme i dalje kontrolišu prikaz).
      value = displayValue;
    } else {
      const envVal = _envFallback(def.key);
      if (envVal) {
        source = "env";
        displayValue = envVal;
        value = def.isSecret ? "" : envVal;
      } else {
        displayValue = def.defaultValue;
        value = def.defaultValue;
      }
    }
    const isSet = source !== "default" || displayValue !== def.defaultValue;
    return { key: def.key, value, isSecret: !!def.isSecret, isSet, source, def };
  });
}

/** Grupiše settingse po `group` polju, za UI sekcije. Vraća i redosled grupa. */
export function groupSettings(
  settings: SettingView[],
): { groups: Array<{ key: string; title: string; description: string; items: SettingView[] }> } {
  const order: string[] = [];
  const buckets: Record<string, SettingView[]> = {};
  const meta: Record<string, { title: string; description: string }> = {};

  for (const s of settings) {
    const g = s.def.group;
    if (!buckets[g]) {
      buckets[g] = [];
      order.push(g);
      meta[g] = { title: s.def.groupTitle, description: s.def.groupDescription };
    }
    buckets[g].push(s);
  }

  return {
    groups: order.map((k) => ({
      key: k,
      title: meta[k].title,
      description: meta[k].description,
      items: buckets[k],
    })),
  };
}

/** Čisti in-memory cache (korisno za testiranje ili posle setSetting u istom procesu). */
export function clearSettingsCache(): void {
  _cache.clear();
}