"use server";

import { revalidatePath } from "next/cache";
import { setSetting, clearSetting, SETTINGS_CATALOG } from "@/core/settings";

export async function saveSettings(formData: FormData) {
  const keys = formData.getAll("keys").map(String);
  const values = formData.getAll("values").map(String);

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const value = values[i] ?? "";
    const def = SETTINGS_CATALOG[key];
    if (!def) continue;
    if (value === "") clearSetting(key);
    else setSetting(key, value, def.isSecret ?? false);
  }
  revalidatePath("/settings");
}
