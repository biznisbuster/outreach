/** POST /leads/[id]/new-email — manualno kreiraj draft email (bez AI). */
import type { APIRoute } from "astro";
import { getDb, schema } from "../../../lib/api";
import { z } from "zod";

const schema_ = z.object({
  subject: z.string().min(1),
  body: z.string().min(1),
});

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const id = Number(params.id);
  const form = await request.formData();
  const parsed = schema_.safeParse({ subject: form.get("subject"), body: form.get("body") });
  if (!parsed.success) return redirect(`/leads/${id}?error=${encodeURIComponent("Neispravan email")}`, 303);
  const db = getDb();
  db.insert(schema.emailSends)
    .values({
      leadId: id,
      subject: parsed.data.subject,
      body: parsed.data.body,
      status: "draft",
      generatedByAi: false,
      reviewed: true,
    })
    .run();
  return redirect(`/leads/${id}?ok=Draft+kreiran`, 303);
};
