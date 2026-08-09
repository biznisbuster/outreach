/**
 * Queue status meta — server-side enums mapirane na UI prezentaciju.
 *
 * `email_sends.status` je fiksiran enum u `schema.ts`:
 *   draft | queued | sending | sent | failed | bounced
 *
 * Ovde mu dajemo srpske labele, boje, ikonice i semantički ton
 * (za KpiCard i progress bar), tako da /queue bude uniforman sa ostatkom dizajna.
 *
 * Koristi se u:
 *   - src/pages/queue.astro (badge u tabeli, progress bar, chip-ovi)
 */
import type { IconName } from "./icons";

export type QueueStatus = "draft" | "queued" | "sending" | "sent" | "failed" | "bounced";

export interface QueueStatusMeta {
  /** Srpska labela prikazana u tabeli, chip-ovima i badge-u */
  label: string;
  /** Hex boja (ista kao u design tokenima — slate/sky/blue/green/red/orange) */
  color: string;
  /** Koji semantic tone da koristi KpiCard / progress bar */
  tone: "muted" | "info" | "primary" | "success" | "destructive" | "warning";
  /** Lucide ikonica */
  icon: IconName;
  /** Opisna poruka za empty state filtera (opciono) */
  hint?: string;
}

export const QUEUE_STATUS_META: Record<QueueStatus, QueueStatusMeta> = {
  draft: {
    label: "Skica",
    color: "#6b7280",
    tone: "muted",
    icon: "file-text",
    hint: "Još nisu zakazani za slanje",
  },
  queued: {
    label: "U redu",
    color: "#0ea5e9",
    tone: "info",
    icon: "clock",
    hint: "Čekaju slanje (worker će ih pokupiti)",
  },
  sending: {
    label: "Šalje se",
    color: "#3b82f6",
    tone: "primary",
    icon: "send-horizontal",
    hint: "Trenutno se šalju",
  },
  sent: {
    label: "Poslato",
    color: "#22c55e",
    tone: "success",
    icon: "check-circle",
  },
  failed: {
    label: "Neuspešno",
    color: "#ef4444",
    tone: "destructive",
    icon: "alert-triangle",
    hint: "Slanje puklo — pogledaj error polje",
  },
  bounced: {
    label: "Vraćeno",
    color: "#f97316",
    tone: "warning",
    icon: "ban",
    hint: "Adresa nevažeća — lead dodat u blocklist",
  },
};

/** Set "otvorenih" statusa — sve što NIJE završilo (draft ∪ queued ∪ sending). */
export const QUEUE_OPEN_STATUSES: QueueStatus[] = ["draft", "queued", "sending"];

/** Svi statusi u redosledu prikaza (logički: draft → queued → sending → sent | failed | bounced). */
export const QUEUE_STATUS_ORDER: QueueStatus[] = ["draft", "queued", "sending", "sent", "failed", "bounced"];

export function queueStatusMeta(status: string): QueueStatusMeta | null {
  return QUEUE_STATUS_META[status as QueueStatus] ?? null;
}