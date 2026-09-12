import { createHash } from "crypto";
import type { JobChange, PaymentPlanPart, QuoteVersion } from "./types";
import { canonicalRichText } from "./richtext";

/**
 * Kanonisk form av betalplanen. Äldre delar ({label, percent}) serialiseras
 * exakt som förut så att signerade versioner behåller sitt hash. Nya valfria
 * fält (kind, amount) läggs bara till när de finns, i jsonb:s nyckelordning
 * (längd, sedan bytevis) – lagringen bevarar inte insättningsordningen.
 */
export function canonicalPaymentPlan(plan: PaymentPlanPart[]): Record<string, unknown>[] {
  return plan.map((part) => ({
    ...(part.kind !== undefined ? { kind: part.kind } : {}),
    label: part.label,
    ...(part.amount !== undefined ? { amount: part.amount } : {}),
    percent: part.percent,
  }));
}

/**
 * Kanoniskt, verifierbart hash av en offertversions innehåll.
 * Används för att i efterhand kunna styrka exakt vad kunden godkände på offertlänken.
 */
export function quoteVersionHash(v: QuoteVersion): string {
  const canonical = JSON.stringify({
    quoteId: v.quoteId,
    version: v.version,
    title: v.title,
    // Legacy: nya versioner saknar intro (undefined → nyckeln utelämnas av
    // JSON.stringify). Låsta versioner med intro behåller sitt historiska hash.
    intro: v.intro,
    lines: v.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
    })),
    rot: v.rot ? { type: v.rot.type } : v.rot,
    paymentPlan: canonicalPaymentPlan(v.paymentPlan),
    paymentTermsDays: v.paymentTermsDays,
    // Villkorligt så att versioner signerade innan fältet fanns behåller sitt hash.
    ...(v.lateInterestRate !== undefined ? { lateInterestRate: v.lateInterestRate } : {}),
    validUntil: v.validUntil,
    terms: v.terms,
    // Villkorligt: offerter utan applied-belopp behåller sitt hash.
    ...(v.rot && v.rot.appliedTaxReduction !== undefined
      ? { appliedTaxReduction: v.rot.appliedTaxReduction }
      : {}),
    ...(v.rot && v.rot.taxReductionManuallyAdjusted
      ? { taxReductionManuallyAdjusted: true }
      : {}),
    // Villkorligt så att versioner signerade innan ROT/RUT-villkoren fanns behåller sitt hash.
    ...(v.taxReductionTerms
      ? {
          taxReductionTerms: {
            version: v.taxReductionTerms.version,
            type: v.taxReductionTerms.type,
            heading: v.taxReductionTerms.heading,
            body: v.taxReductionTerms.body,
            text: v.taxReductionTerms.text,
          },
        }
      : {}),
    // Villkorligt så att versioner signerade innan fältet fanns behåller sitt hash.
    // Kanonisk (nyckelsorterad) form: jsonb bevarar inte nyckelordning.
    ...(v.richText ? { richText: canonicalRichText(v.richText) } : {}),
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Kanoniskt hash av en ändrings innehåll (Ändringar och tillägg) – det kunden
 * faktiskt godkänner via /andring/[token]. Snapshots och status ingår inte.
 */
export function jobChangeContentHash(
  c: Pick<JobChange, "jobId" | "number" | "version" | "title" | "description" | "timeImpact" | "lines">
): string {
  const canonical = JSON.stringify({
    jobId: c.jobId,
    number: c.number,
    version: c.version,
    title: c.title,
    description: c.description,
    ...(c.timeImpact ? { timeImpact: c.timeImpact } : {}),
    lines: c.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
      ...(l.discountPercent ? { discountPercent: l.discountPercent } : {}),
      ...(l.isHeading ? { isHeading: true } : {}),
    })),
  });
  return createHash("sha256").update(canonical).digest("hex");
}
