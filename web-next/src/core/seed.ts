import { getDb, schema } from "./db";
import { DEFAULT_PROMPTS, DEFAULT_STATUSES } from "./prompts";
import { eq, and } from "drizzle-orm";
import { ensureSingleUser } from "./auth";

let seeded = false;

/** Idempotentno ubaci default statusi/prompte i single user ako ih nema. */
export async function ensureSeed(): Promise<void> {
  if (seeded) return;
  const db = getDb();

  const existingStatuses = db.select().from(schema.statuses).all();
  if (existingStatuses.length === 0) {
    for (const s of DEFAULT_STATUSES) {
      db.insert(schema.statuses)
        .values({
          name: s.name,
          color: s.color,
          isTerminalWon: s.isTerminalWon ?? false,
          isTerminalLost: s.isTerminalLost ?? false,
          isActive: true,
          sortOrder: s.sortOrder,
          systemDefault: s.systemDefault ?? false,
        })
        .run();
    }
  }

  for (const p of DEFAULT_PROMPTS) {
    const exists = db
      .select()
      .from(schema.promptTemplates)
      .where(and(eq(schema.promptTemplates.type, p.type), eq(schema.promptTemplates.isDefault, true)))
      .all();
    if (exists.length === 0) {
      db.insert(schema.promptTemplates)
        .values({ name: p.name, type: p.type, body: p.body, isDefault: true })
        .run();
    }
  }

  await ensureSingleUser().catch((e) => console.error("[seed] ensureSingleUser greška:", e));
  seeded = true;
}
