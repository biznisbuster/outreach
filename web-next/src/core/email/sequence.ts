/**
 * Sequence advancer — u v2 bez AI se samo pauzira.
 * Sekvence i dalje postoje u bazi (radi kompatibilnosti), ali auto-advance
 * preskače generisanje jer je AI uklonjen. Korisnik može ručno da popuni
 * sledeći draft iz templates ili da kreira email direktno.
 */
import { getDb, schema } from "@/core/db";
import { eq, and, asc } from "drizzle-orm";

export async function advanceSequence(
  _emailSendId: number,
  _leadId: number,
  _campaignId: number,
  _sentAt: Date,
): Promise<{ advanced: boolean; nextQueued?: number }> {
  // AI automatsko napredovanje sekvence je uklonjeno (v2 = no AI).
  return { advanced: false };
}

/** Broj aktivnih sekvenci u kampanji (za prikaz u UI). */
export function listActiveSequences(campaignId: number) {
  const db = getDb();
  return db
    .select()
    .from(schema.sequences)
    .where(and(eq(schema.sequences.campaignId, campaignId), eq(schema.sequences.active, true)))
    .all();
}

/** Steps za jednu sekvencu. */
export function listSequenceSteps(sequenceId: number) {
  const db = getDb();
  return db
    .select()
    .from(schema.sequenceSteps)
    .where(eq(schema.sequenceSteps.sequenceId, sequenceId))
    .orderBy(asc(schema.sequenceSteps.stepNumber))
    .all();
}
