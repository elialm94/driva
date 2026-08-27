import { createHash } from "crypto";
import type { QuoteVersion } from "./types";

/**
 * Kanoniskt, verifierbart hash av en offertversions innehåll.
 * Används för att i efterhand kunna styrka exakt vad kunden godkände med BankID.
 */
export function quoteVersionHash(v: QuoteVersion): string {
  const canonical = JSON.stringify({
    quoteId: v.quoteId,
    version: v.version,
    title: v.title,
    intro: v.intro,
    lines: v.lines.map((l) => ({
      kind: l.kind,
      description: l.description,
      qty: l.qty,
      unit: l.unit,
      unitPrice: l.unitPrice,
      vatRate: l.vatRate,
    })),
    rot: v.rot,
    paymentPlan: v.paymentPlan,
    paymentTermsDays: v.paymentTermsDays,
    // Villkorligt så att versioner signerade innan fältet fanns behåller sitt hash.
    ...(v.lateInterestRate !== undefined ? { lateInterestRate: v.lateInterestRate } : {}),
    validUntil: v.validUntil,
    terms: v.terms,
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
