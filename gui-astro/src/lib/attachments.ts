/**
 * Email attachments — helpers za upload, čuvanje i slanje.
 *
 * Storage:
 *   ~/outreach-data/attachments/<sha256>.<ext>   (na hostu, van repo-a)
 *   /data/attachments/<sha256>.<ext>            (unutar kontejnera, kroz mount)
 *
 * Validacija:
 *   - MIME tip mora biti u attachment_allowed_mime (settings, comma-list)
 *   - Size <= attachment_max_size_mb (settings)
 *   - Prazan fajl se odbija
 *
 * Dedup:
 *   - Računa se SHA-256 pre čuvanja
 *   - Ako attachment sa istim sha256 već postoji → vraća se postojeći
 *     (upload ne pravi duplikat, nema double-storage)
 *
 * Send logika (vidi getAttachmentsForSend):
 *   1. Ako draft ima email_send_attachments → koristi SAMO te (override)
 *   2. Inače ako email ima prompt_template_id → koristi template_attachments
 *   3. Inače → nema attachment-a
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, unlink, stat } from "node:fs/promises";
import { join, extname } from "node:path";
import { eq, and, count } from "drizzle-orm";
import { getDb, schema } from "./db";
import { getSetting } from "./settings";

// ─── Storage paths ───────────────────────────────────────────────────────

/** Storage dir na disku. env var ima prednost (compose override), inače default. */
function getStorageDir(): string {
  const envPath = process.env.OUTREACH_DATA_DIR || process.env.DATA_DIR;
  if (envPath) return join(envPath, "attachments");
  // Lokalni dev fallback: gui-astro/../data/attachments
  return join(process.cwd(), "data", "attachments");
}

/** Generiše storage filename: "<sha256>.<ext>" */
function storageFilename(sha256: string, originalName: string): string {
  const ext = extname(originalName).toLowerCase().replace(/[^a-z0-9.]/g, "");
  return ext ? `${sha256}${ext}` : sha256;
}

// ─── Validacija ──────────────────────────────────────────────────────────

export interface ValidationResult {
  ok: boolean;
  error?: string;
}

function parseAllowedMime(): string[] {
  const raw = getSetting("attachment_allowed_mime") || "application/pdf,image/jpeg,image/png,image/webp";
  return raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function maxSizeBytes(): number {
  const mb = Number(getSetting("attachment_max_size_mb") || "10");
  return Math.max(1, mb) * 1024 * 1024;
}

export function validateUpload(file: File | { size: number; type: string; name: string }): ValidationResult {
  if (!file || file.size === 0) return { ok: false, error: "Prazan fajl" };
  if (file.size > maxSizeBytes()) {
    return {
      ok: false,
      error: `Fajl je ${(file.size / 1024 / 1024).toFixed(1)}MB, max je ${getSetting("attachment_max_size_mb")}MB`,
    };
  }
  const allowed = parseAllowedMime();
  const mime = (file.type || "").toLowerCase();
  if (!mime || !allowed.includes(mime)) {
    return {
      ok: false,
      error: `MIME tip "${mime || "?"}" nije dozvoljen. Dozvoljeni: ${allowed.join(", ")}`,
    };
  }
  return { ok: true };
}

// ─── Čuvanje i dedup ────────────────────────────────────────────────────

export interface SavedAttachment {
  id: number;
  filename: string;
  originalName: string;
  mimeType: string;
  size: number;
  sha256: string;
  reused: boolean; // true ako je dedup hit (postojao isti sha256)
}

/**
 * Čuva attachment na disk + INSERT u bazu. Ako sha256 već postoji → vraća
 * postojeći (dedup). Fajl se NE duplicira.
 *
 * @param bytes  sirovi bajtovi fajla
 * @param meta   { originalName, mimeType }
 */
export async function saveAttachment(
  bytes: Uint8Array,
  meta: { originalName: string; mimeType: string },
): Promise<SavedAttachment> {
  const db = getDb();
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const filename = storageFilename(sha256, meta.originalName);

  // Dedup: ako sha256 postoji, vrati postojeći (NE pišemo duplikat na disk).
  const existing = db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.sha256, sha256))
    .all()[0];
  if (existing) {
    return { ...existing, reused: true };
  }

  // Upis na disk
  const dir = getStorageDir();
  await mkdir(dir, { recursive: true });
  const fullPath = join(dir, filename);
  await writeFile(fullPath, bytes);

  // INSERT u bazu
  const [created] = db
    .insert(schema.attachments)
    .values({
      filename,
      originalName: meta.originalName,
      mimeType: meta.mimeType,
      size: bytes.length,
      sha256,
    })
    .returning()
    .all();

  return { ...created, reused: false };
}

// ─── Čitanje attachment-a za slanje ────────────────────────────────────

export interface AttachmentRef {
  filename: string; // original_name (npr. "Ponuda.pdf")
  path: string;     // apsolutni path na disku
}

/**
 * Vraća attachment-e koje treba poslati za dati email_send.
 *
 * Pravilo:
 *   1. Ako draft ima bar jedan email_send_attachments → SAMO ti (override)
 *   2. Inače ako email ima prompt_template_id → template attachments
 *   3. Inače → []
 */
export function getAttachmentsForSend(emailSendId: number): AttachmentRef[] {
  const db = getDb();
  const dir = getStorageDir();

  // 1) Draft override
  const draftAtts = db
    .select({
      filename: schema.attachments.filename,
      originalName: schema.attachments.originalName,
    })
    .from(schema.emailSendAttachments)
    .innerJoin(schema.attachments, eq(schema.attachments.id, schema.emailSendAttachments.attachmentId))
    .where(eq(schema.emailSendAttachments.emailSendId, emailSendId))
    .all();

  if (draftAtts.length > 0) {
    return draftAtts.map((a) => ({ filename: a.originalName, path: join(dir, a.filename) }));
  }

  // 2) Template default
  const send = db
    .select({ promptTemplateId: schema.emailSends.promptTemplateId })
    .from(schema.emailSends)
    .where(eq(schema.emailSends.id, emailSendId))
    .all()[0];

  if (send?.promptTemplateId) {
    const tmplAtts = db
      .select({
        filename: schema.attachments.filename,
        originalName: schema.attachments.originalName,
        sortOrder: schema.templateAttachments.sortOrder,
      })
      .from(schema.templateAttachments)
      .innerJoin(schema.attachments, eq(schema.attachments.id, schema.templateAttachments.attachmentId))
      .where(eq(schema.templateAttachments.templateId, send.promptTemplateId))
      .orderBy(schema.templateAttachments.sortOrder)
      .all();
    return tmplAtts.map((a) => ({ filename: a.originalName, path: join(dir, a.filename) }));
  }

  return [];
}

// ─── Template attachment helpers ────────────────────────────────────────

export function listTemplateAttachments(templateId: number) {
  const db = getDb();
  return db
    .select({
      id: schema.attachments.id,
      filename: schema.attachments.filename,
      originalName: schema.attachments.originalName,
      mimeType: schema.attachments.mimeType,
      size: schema.attachments.size,
      sortOrder: schema.templateAttachments.sortOrder,
      uploadedAt: schema.attachments.uploadedAt,
    })
    .from(schema.templateAttachments)
    .innerJoin(schema.attachments, eq(schema.attachments.id, schema.templateAttachments.attachmentId))
    .where(eq(schema.templateAttachments.templateId, templateId))
    .orderBy(schema.templateAttachments.sortOrder)
    .all();
}

export function attachToTemplate(templateId: number, attachmentId: number): { ok: boolean; error?: string } {
  const db = getDb();
  const existing = db
    .select()
    .from(schema.templateAttachments)
    .where(
      and(
        eq(schema.templateAttachments.templateId, templateId),
        eq(schema.templateAttachments.attachmentId, attachmentId),
      ),
    )
    .all();
  if (existing.length > 0) return { ok: true }; // idempotent

  const maxOrder = db
    .select({ s: schema.templateAttachments.sortOrder })
    .from(schema.templateAttachments)
    .where(eq(schema.templateAttachments.templateId, templateId))
    .all();
  const nextOrder = maxOrder.length === 0 ? 0 : Math.max(...maxOrder.map((r) => r.s)) + 1;

  db.insert(schema.templateAttachments)
    .values({ templateId, attachmentId, sortOrder: nextOrder })
    .run();
  return { ok: true };
}

export function detachFromTemplate(templateId: number, attachmentId: number): void {
  const db = getDb();
  db.delete(schema.templateAttachments)
    .where(
      and(
        eq(schema.templateAttachments.templateId, templateId),
        eq(schema.templateAttachments.attachmentId, attachmentId),
      ),
    )
    .run();
}

// ─── Draft attachment helpers (override) ────────────────────────────────

export function listDraftAttachments(emailSendId: number) {
  const db = getDb();
  return db
    .select({
      id: schema.attachments.id,
      filename: schema.attachments.filename,
      originalName: schema.attachments.originalName,
      mimeType: schema.attachments.mimeType,
      size: schema.attachments.size,
      uploadedAt: schema.attachments.uploadedAt,
    })
    .from(schema.emailSendAttachments)
    .innerJoin(schema.attachments, eq(schema.attachments.id, schema.emailSendAttachments.attachmentId))
    .where(eq(schema.emailSendAttachments.emailSendId, emailSendId))
    .all();
}

/**
 * Override znači ZAMENU — briše sve prethodne email_send_attachments za draft,
 * dodaje novu listu (ili praznu ako je data).
 */
export function setDraftAttachments(emailSendId: number, attachmentIds: number[]): void {
  const db = getDb();
  db.transaction((tx) => {
    tx.delete(schema.emailSendAttachments)
      .where(eq(schema.emailSendAttachments.emailSendId, emailSendId))
      .run();
    for (const aid of attachmentIds) {
      tx.insert(schema.emailSendAttachments).values({ emailSendId, attachmentId: aid }).run();
    }
  });
}

// ─── Brisanje i usage check ─────────────────────────────────────────────

export interface AttachmentUsage {
  usedByTemplates: number;
  usedByDrafts: number;
}

export function getAttachmentUsage(attachmentId: number): AttachmentUsage {
  const db = getDb();
  const t = db
    .select({ c: count() })
    .from(schema.templateAttachments)
    .where(eq(schema.templateAttachments.attachmentId, attachmentId))
    .all()[0];
  const d = db
    .select({ c: count() })
    .from(schema.emailSendAttachments)
    .where(eq(schema.emailSendAttachments.attachmentId, attachmentId))
    .all()[0];
  return {
    usedByTemplates: Number(t?.c ?? 0),
    usedByDrafts: Number(d?.c ?? 0),
  };
}

/**
 * Briše attachment fajl sa diska i red iz baze.
 * Baca grešku ako je u upotrebi.
 */
export async function deleteAttachment(attachmentId: number): Promise<{ ok: boolean; error?: string }> {
  const db = getDb();
  const att = db
    .select()
    .from(schema.attachments)
    .where(eq(schema.attachments.id, attachmentId))
    .all()[0];
  if (!att) return { ok: false, error: "Attachment ne postoji" };

  const usage = getAttachmentUsage(attachmentId);
  if (usage.usedByTemplates > 0 || usage.usedByDrafts > 0) {
    return {
      ok: false,
      error: `Koristi se: ${usage.usedByTemplates} template-a, ${usage.usedByDrafts} draft-ova. Prvo odveži.`,
    };
  }

  // Obriši fajl (best-effort)
  try {
    await unlink(join(getStorageDir(), att.filename));
  } catch {
    // Ignore: fajl možda ne postoji
  }

  db.delete(schema.attachments).where(eq(schema.attachments.id, attachmentId)).run();
  return { ok: true };
}

// ─── File stat (za UI prikaz veličine) ─────────────────────────────────

export async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}