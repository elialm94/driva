import type { TaxReductionTermsSnapshot } from "@/lib/types";
import { getInvoiceTaxReductionDisclaimer, taxReductionCalcHintText } from "@/lib/tax-reduction-terms";
import { Info } from "lucide-react";

/** ROT/RUT-villkor som underrubrik i Villkor-sektionen – inte ett eget kort. */
export function TaxReductionQuoteClause({
  terms,
}: {
  terms: Pick<TaxReductionTermsSnapshot, "heading" | "body"> | null | undefined;
}) {
  if (!terms) return null;
  return (
    <div className="mt-4">
      <p className="text-[13px] font-semibold text-ink">{terms.heading}</p>
      <p className="mt-1 whitespace-pre-line text-[13px] leading-relaxed text-soft">{terms.body}</p>
    </div>
  );
}

export function TaxReductionInvoiceDisclaimer({ version }: { version?: string }) {
  return (
    <p className="mt-3 text-[12px] leading-relaxed text-muted">{getInvoiceTaxReductionDisclaimer(version)}</p>
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

export function TaxReductionCalcHint({ type, laborInclVat }: { type: "rot" | "rut"; laborInclVat: number }) {
  return (
    <details className="mt-2">
      <summary className="cursor-pointer text-[12px] text-muted">Hur räknas detta?</summary>
      <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{taxReductionCalcHintText(type, laborInclVat)}</p>
    </details>
  );
}
