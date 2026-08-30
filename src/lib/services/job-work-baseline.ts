/**
 * Avtalad baseline från godkänd offert. Ligger utanför job-work.ts så
 * store.normalize kan hydrera utan store ↔ job-work-importcykel.
 */
import { uid } from "../ids";
import type { DB, JobWorkEntryType, LineKind, Quote, QuoteVersion } from "../types";

export function lineKindToWorkType(kind: LineKind): JobWorkEntryType {
  if (kind === "arbete") return "labor";
  if (kind === "material") return "material";
  return "other";
}

export function syncQuotedBaselineFromVersion(
  data: DB,
  jobId: string,
  version: QuoteVersion,
  quote: Quote
): boolean {
  data.jobWorkEntries ??= [];
  const existingIds = new Set(
    data.jobWorkEntries
      .filter((e) => e.jobId === jobId && e.role === "planned" && e.quotedLineItemId)
      .map((e) => e.quotedLineItemId as string)
  );
  const date = (quote.decidedAt ?? quote.createdAt ?? new Date().toISOString()).slice(0, 10);
  const now = new Date().toISOString();
  let added = false;
  for (const line of version.lines) {
    if (existingIds.has(line.id)) continue;
    data.jobWorkEntries.push({
      id: uid(),
      jobId,
      role: "planned",
      type: lineKindToWorkType(line.kind),
      description: line.description,
      date,
      qty: line.qty,
      unit: line.unit,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      source: "quote",
      quotedLineItemId: line.id,
      isExtra: false,
      createdAt: now,
      updatedAt: now,
    });
    added = true;
  }
  return added;
}

export function hydrateQuotedBaselines(data: DB): boolean {
  data.jobWorkEntries ??= [];
  let changed = false;
  const quoteById = new Map(data.quotes.map((q) => [q.id, q]));
  const versionById = new Map(data.quoteVersions.map((v) => [v.id, v]));
  for (const job of data.jobs) {
    const quote =
      (job.quoteId ? quoteById.get(job.quoteId) : undefined) ?? data.quotes.find((q) => q.jobId === job.id);
    if (!quote || quote.status !== "godkand") continue;
    const version = versionById.get(quote.currentVersionId);
    if (!version) continue;
    if (syncQuotedBaselineFromVersion(data, job.id, version, quote)) changed = true;
  }
  return changed;
}
