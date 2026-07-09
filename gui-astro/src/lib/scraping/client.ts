// HTTP klijent ka Python scraper servisu. URL se čita iz settings
// (DB → env → default), tako da se može menjati iz /settings bez restarta.
import { getSetting, getSettingInt } from "@/lib/settings";

export async function triggerScrape(leadId: number): Promise<{ jobId: string }> {
  const SCRAPER_URL = getSetting("scraper_url");
  const maxPages = getSettingInt("scraper_max_pages") || 20;
  const res = await fetch(`${SCRAPER_URL}/scrape`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lead_id: leadId, max_pages: maxPages }),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => res.statusText);
    throw new Error(`Scraper greška: ${res.status} ${txt}`);
  }
  const data = await res.json();
  return { jobId: data.job_id ?? data.jobId };
}

export async function getScrapeStatus(jobId: string): Promise<unknown> {
  const SCRAPER_URL = getSetting("scraper_url");
  const res = await fetch(`${SCRAPER_URL}/scrape/status/${jobId}`);
  if (!res.ok) throw new Error(`Scraper status greška: ${res.status}`);
  return res.json();
}

export interface ScrapeStatus {
  job_id: string;
  status: "queued" | "running" | "done" | "failed";
  pages_scraped: number;
  total_pages: number;
  screenshot: string | null;
  finished_at: number | null;
  error: string | null;
  lead_id: number;
}
