/**
 * Pokreće se jednom pri startu servera (Next.js instrumentation hook).
 * - Otvori bazu + seed-uj ako treba
 * - Pokreni scheduler (queue tick + IMAP poll) ako je omogućen
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  try {
    const { getDb } = await import("@/core/db");
    const { ensureSeed } = await import("@/core/seed");
    getDb();
    await ensureSeed();
    console.log("[instrumentation] Baza spremna.");
  } catch (e) {
    console.error("[instrumentation] Greška pri inicijalizaciji baze:", e);
  }

  // Scheduler enabled: legacy env override (1/0) > DB setting > production default (1).
  let shouldStart: boolean;
  if (process.env.SCHEDULER_ENABLED === "1" || process.env.SCHEDULER_ENABLED === "0") {
    shouldStart = process.env.SCHEDULER_ENABLED === "1";
  } else {
    try {
      const { getSetting } = await import("@/core/settings");
      const v = getSetting("scheduler_enabled");
      shouldStart = v === "1" || v.toLowerCase() === "true";
    } catch {
      shouldStart = process.env.NODE_ENV === "production";
    }
  }
  if (!shouldStart) {
    console.log("[instrumentation] Scheduler onemogućen (scheduler_enabled=0, dev mod).");
    return;
  }

  try {
    const { startScheduler } = await import("@/core/workers/scheduler");
    startScheduler();
    console.log("[instrumentation] Scheduler pokrenut.");
  } catch (e) {
    console.error("[instrumentation] Scheduler nije pokrenut:", e);
  }
}
