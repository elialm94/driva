import type { TaxReductionTermsSnapshot } from "@/lib/types";
import { getInvoiceTaxReductionDisclaimer, getTaxReductionTerms } from "@/lib/tax-reduction-terms";
import { kr } from "@/lib/format";
import { taxReductionCalcHintText } from "@/lib/tax-reduction-terms";
import { Info } from "lucide-react";

/**
 * ROT/RUT-villkoret på offertdokumentet. Hör ihop med summeringen, så det står
 * som en not direkt under den – alltid fullt läsbart, aldrig bakom en expand.
 */
export function TaxReductionQuoteClause({
  terms,
}: {
  terms: Pick<TaxReductionTermsSnapshot, "heading" | "body"> | null | undefined;
}) {
  if (!terms) return null;
  return (
    <p className="mt-2 max-w-[46rem] text-[11px] leading-[1.5] text-muted">
      <span className="font-semibold text-soft">{terms.heading}:</span> {terms.body}
    </p>
  );
}

export function TaxReductionInvoiceDisclaimer({ version }: { version?: string }) {
  return (
    <p className="mt-2 max-w-[46rem] text-[11px] leading-[1.5] text-muted">
      {getInvoiceTaxReductionDisclaimer(version)}
    </p>
  );
}

/** Diskret hint i fakturaeditorn – full text på dokumentet. */
export function TaxReductionEditorHint({ version }: { version?: string }) {
  const text = getInvoiceTaxReductionDisclaimer(version);
  return (
    <details className="mt-2">
      <summary
        className="flex cursor-pointer list-none items-center gap-1 text-[12px] text-muted marker:content-none [&::-webkit-details-marker]:hidden"
        title={text}
      >
        <Info className="size-3.5 shrink-0" aria-hidden />
        Avdraget är preliminärt
      </summary>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{text}</p>
    </details>
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

export function TaxReductionCalcHint({ type, laborInclVat }: { type: "rot" | "rut"; laborInclVat: number }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[12px] text-muted">Hur räknas detta?</summary>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{taxReductionCalcHintText(type, laborInclVat)}</p>
    </details>
  );
}
