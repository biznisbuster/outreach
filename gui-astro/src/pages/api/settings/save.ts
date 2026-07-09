/** GET /api/settings/save — list (sve). POST — update (bulk). */
import type { APIRoute } from "astro";
import { ok, bad } from "../../../lib/api";
import { getAllSettings, setSetting, clearSetting, SETTINGS_CATALOG, groupSettings } from "../../../lib/settings";
import { z } from "zod";

export const GET: APIRoute = async () => {
  const all = getAllSettings();
  const { groups } = groupSettings(all);
  return ok({ items: all, grouped: groups });
};

const updateSchema = z.object({
  updates: z.array(
    z.object({
      key: z.string(),
      value: z.string().nullable(),
      clear: z.boolean().optional(),
    }),
  ),
});

export const POST: APIRoute = async ({ request }) => {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message || "Neispravan unos");

  for (const u of parsed.data.updates) {
    if (u.clear || u.value === null || u.value === "") {
      clearSetting(u.key);
      continue;
    }
    const def = SETTINGS_CATALOG[u.key];
    setSetting(u.key, u.value, def?.isSecret ?? false);
  }
  const all = getAllSettings();
  const { groups } = groupSettings(all);
  return ok({ items: all, grouped: groups });
};
