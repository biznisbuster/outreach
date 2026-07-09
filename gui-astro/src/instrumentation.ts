/**
 * Pokreće se jednom pri startu servera (Astro instrumentation hook).
 * - Otvori bazu + seed-uj ako treba
 * - Pokreni scheduler (queue tick + IMAP poll) ako je omogućen
 *
 * Scheduler enabled se čita iz settings (DB > env > default), a env
 * SCHEDULER_ENABLED=1 i dalje radi kao legacy override (za backward compat).
 */
export async function register() {
  if (process.env.ASTRO_RUNTIME !== "node") return;

  try {
    const { getDb } = await import("./lib/db");
    const { ensureSeed } = await import("./lib/seed");
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
      const { getSetting } = await import("./lib/settings");
      const v = getSetting("scheduler_enabled");
      shouldStart = v === "1" || v.toLowerCase() === "true";
    } catch {
      // settings import failed (nema DB još) — production default
      shouldStart = process.env.NODE_ENV === "production";
    }
  }
  if (!shouldStart) {
    console.log("[instrumentation] Scheduler onemogućen (scheduler_enabled=0, dev mod).");
    return;
  }

  try {
    const { startScheduler } = await import("./lib/workers/scheduler");
    startScheduler();
    console.log("[instrumentation] Scheduler pokrenut.");
  } catch (e) {
    console.error("[instrumentation] Scheduler nije pokrenut:", e);
  }
}
