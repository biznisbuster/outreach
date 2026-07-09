import type { APIRoute } from "astro";
import { getDb, schema, ok, bad } from "../../lib/api";
import { asc } from "drizzle-orm";
import { z } from "zod";
import { logAudit } from "../../lib/audit";

export const GET: APIRoute = async () => {
  const db = getDb();
  const rows = db.select().from(schema.statuses).orderBy(asc(schema.statuses.sortOrder)).all();
  return ok({ items: rows });
};

const createSchema = z.object({
  name: z.string().min(1).max(40),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Boja mora biti #rrggbb"),
  isTerminalWon: z.boolean().default(false),
  isTerminalLost: z.boolean().default(false),
  sortOrder: z.number().int().optional(),
});

export const POST: APIRoute = async ({ request }) => {
  const ct = request.headers.get("content-type") ?? "";
  let raw: Record<string, unknown> = {};
  if (ct.includes("application/json")) {
    raw = await request.json().catch(() => ({}));
  } else {
    const form = await request.formData();
    raw = Object.fromEntries(form.entries());
    if ("isTerminalWon" in raw) raw.isTerminalWon = true;
    if ("isTerminalLost" in raw) raw.isTerminalLost = true;
  }
  const parsed = createSchema.safeParse({
    ...raw,
    isTerminalWon: raw.isTerminalWon === true || raw.isTerminalWon === "on" || raw.isTerminalWon === "true",
    isTerminalLost: raw.isTerminalLost === true || raw.isTerminalLost === "on" || raw.isTerminalLost === "true",
    sortOrder: raw.sortOrder ? Number(raw.sortOrder) : undefined,
  });
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "Neispravan unos");
  const data = parsed.data;

  const db = getDb();
  // ako nije zadat sortOrder, stavi na kraj
  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const last = db
      .select({ s: schema.statuses.sortOrder })
      .from(schema.statuses)
      .orderBy(asc(schema.statuses.sortOrder))
      .all()
      .at(-1);
    sortOrder = (last?.s ?? 0) + 1;
  }

  const [created] = db
    .insert(schema.statuses)
    .values({
      name: data.name,
      color: data.color,
      isTerminalWon: data.isTerminalWon,
      isTerminalLost: data.isTerminalLost,
      isActive: true,
      sortOrder,
      systemDefault: false,
    })
    .returning()
    .all();
  if (created) logAudit("settings.change", "status", created.id, { name: created.name });
  return ok(created, 201);
};
