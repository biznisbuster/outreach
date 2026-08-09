import { NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb, schema } from "@/core/db";
import { saveAttachment, validateUpload } from "@/core/attachments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = getDb();
  const rows = db.select().from(schema.attachments).orderBy(desc(schema.attachments.id)).all();
  return NextResponse.json({ items: rows });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Mora biti multipart/form-data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.redirect(new URL("/attachments?error=Polje+fajl+nedostaje", req.url), 303);
  }

  const v = validateUpload(file);
  if (!v.ok) {
    return NextResponse.redirect(
      new URL(`/attachments?error=${encodeURIComponent(v.error || "Neispravan fajl")}`, req.url),
      303,
    );
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await saveAttachment(bytes, { originalName: file.name, mimeType: file.type });
    return NextResponse.redirect(new URL("/attachments?ok=Otpremljeno", req.url), 303);
  } catch (e) {
    return NextResponse.redirect(
      new URL(`/attachments?error=${encodeURIComponent(`Upload greška: ${e instanceof Error ? e.message : String(e)}`)}`, req.url),
      303,
    );
  }
}
