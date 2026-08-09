"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getDb, schema } from "@/core/db";
import { logAudit } from "@/core/audit";

export async function setLeadStatus(formData: FormData) {
  const id = Number(formData.get("id"));
  const statusIdRaw = formData.get("statusId");
  const statusId = statusIdRaw === "" || statusIdRaw === null ? null : Number(statusIdRaw);

  const db = getDb();
  const before = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all()[0];
  if (!before) return;

  db.update(schema.leads)
    .set({ statusId, updatedAt: new Date() })
    .where(eq(schema.leads.id, id))
    .run();
  logAudit("lead.status_change", "lead", id, { from: before.statusId, to: statusId });
  revalidatePath(`/leads/${id}`);
  revalidatePath("/leads");
}

export async function addLeadComment(formData: FormData) {
  const id = Number(formData.get("id"));
  const body = String(formData.get("body") ?? "").trim();
  if (!body) return;

  const db = getDb();
  db.insert(schema.comments).values({ leadId: id, body }).run();
  revalidatePath(`/leads/${id}`);
}

export async function blockLead(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const existing = db.select().from(schema.blocklist).where(eq(schema.blocklist.leadId, id)).all();
  if (existing.length === 0) db.insert(schema.blocklist).values({ leadId: id, reason: "user" }).run();
  db.update(schema.leads).set({ doNotContact: true }).where(eq(schema.leads.id, id)).run();
  logAudit("lead.update", "lead", id);
  revalidatePath(`/leads/${id}`);
}

export async function unblockLead(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  db.update(schema.leads).set({ doNotContact: false }).where(eq(schema.leads.id, id)).run();
  logAudit("lead.update", "lead", id);
  revalidatePath(`/leads/${id}`);
}

export async function deleteLead(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  db.delete(schema.leads).where(eq(schema.leads.id, id)).run();
  logAudit("lead.delete", "lead", id);
  revalidatePath("/leads");
  redirect("/leads");
}

export async function triggerLeadScrape(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const [lead] = db.select().from(schema.leads).where(eq(schema.leads.id, id)).all();
  if (!lead) return;

  const url = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    await fetch(`${url}/scrape`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lead_id: id, max_pages: 20, website: lead.websiteNormalized }),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    /* scraper nedostupan — UI prikazuje status preko sledećeg rendera */
  }
  revalidatePath(`/leads/${id}`);
}

export async function runSiteAudit(formData: FormData) {
  const id = Number(formData.get("id"));
  const db = getDb();
  const lead = db.select().from(schema.leads).where(eq(schema.leads.id, id)).get();
  if (!lead?.websiteNormalized) return;

  const scraperUrl = process.env.SCRAPER_URL ?? "http://127.0.0.1:8001";
  try {
    // Scraper vraća {job_id, status:"running"} odmah — audit radi u pozadini (30–90s).
    await fetch(`${scraperUrl}/audit/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    /* scraper nedostupan */
  }
  revalidatePath(`/leads/${id}`);
}
