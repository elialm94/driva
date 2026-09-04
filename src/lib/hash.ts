import { createHash } from "crypto";
import type { QuoteVersion } from "./types";
import { canonicalRichText } from "./richtext";

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
    paymentPlan: v.paymentPlan,
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
