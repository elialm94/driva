import type { TaxReductionTermsSnapshot } from "@/lib/types";
import { getInvoiceTaxReductionDisclaimer, getTaxReductionTerms } from "@/lib/tax-reduction-terms";

export function TaxReductionQuoteClause({
  terms,
}: {
  terms: Pick<TaxReductionTermsSnapshot, "heading" | "body"> | null | undefined;
}) {
  if (!terms) return null;
  return (
    <div className="mt-4 rounded-xl border border-line bg-canvas/50 px-4 py-3">
      <p className="text-[13px] font-semibold text-ink">{terms.heading}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-soft">{terms.body}</p>
    </div>
  );
}

export function TaxReductionInvoiceDisclaimer({ version }: { version?: string }) {
  return (
    <p className="mt-3 text-[12px] leading-relaxed text-muted">{getInvoiceTaxReductionDisclaimer(version)}</p>
  );
}

/** Live-förhandsvisning i formulär – samma text som offerttjänsten kommer att spara. */
export function TaxReductionFormPreview({ type }: { type: "rot" | "rut" }) {
  const terms = getTaxReductionTerms(type);
  return (
    <div className="mt-3 rounded-xl border border-line bg-canvas/50 px-4 py-3">
      <p className="text-[13px] font-semibold text-ink">{terms.heading}</p>
      <p className="mt-1 text-[12px] leading-relaxed text-soft">{terms.body}</p>
      <p className="mt-2 text-[12px] text-muted">Läggs till automatiskt. Kan inte redigeras.</p>
    </div>
  );
}
