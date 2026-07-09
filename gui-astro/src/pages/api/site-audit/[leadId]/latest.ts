/**
 * GET /api/site-audit/[leadId]/latest
 *
 * Returns the most recent site audit for a lead (as a hydrated report),
 * plus the per-category metric rows. Reads directly from SQLite — fast,
 * no proxy hop.
 */
import type { APIRoute } from "astro";
import { ok, notFound } from "../../../../lib/api";
import { getLatestAuditForLead, getAuditMetrics } from "../../../../lib/siteAudit";

export const GET: APIRoute = async ({ params }) => {
  const leadId = Number(params.leadId);
  if (!leadId) return notFound("leadId obavezan");

  const report = getLatestAuditForLead(leadId);
  if (!report) {
    return ok({ audit: null, metrics: [], reason: "no_audit" });
  }
  const metrics = getAuditMetrics(report.id);
  return ok({ audit: report, metrics });
};
