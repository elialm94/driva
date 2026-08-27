import type { RotRut, TaxReductionTermsSnapshot } from "./types";
import { kr } from "./format";

/**
 * Central ROT/RUT-villkorstext.
 * Alla vyer (offert, förhandsgranskning, BankID, faktura, PDF) läser härifrån.
 * Ändra v1-texten här – eller lägg till en ny version – i stället för att duplicera copy.
 */
export const TAX_REDUCTION_TERMS_VERSION = "v1";

const QUOTE_HEADING = "ROT/RUT-avdrag";

const QUOTE_BODY_V1 =
  "Det angivna ROT/RUT-avdraget är preliminärt och förutsätter att Skatteverket godkänner skattereduktionen. Om Skatteverket helt eller delvis nekar utbetalning har utföraren rätt att fakturera kunden motsvarande återstående belopp.";

const INVOICE_DISCLAIMER_V1 =
  "ROT/RUT är preliminärt. Om Skatteverket helt eller delvis nekar utbetalning kan återstående belopp faktureras kunden.";

export interface TaxReductionTermsText {
  version: string;
  heading: string;
  body: string;
  /** Heading + brödtext, den text som låses i BankID-hashen. */
  text: string;
}

export function getTaxReductionTerms(
  type: RotRut["type"],
  version: string = TAX_REDUCTION_TERMS_VERSION
): TaxReductionTermsText {
  void type;
  if (version !== TAX_REDUCTION_TERMS_VERSION) {
    // Framtida versioner läggs till här. Okänd version: visa v1 så att äldre dokument aldrig blir tomma.
  }
  return {
    version: TAX_REDUCTION_TERMS_VERSION,
    heading: QUOTE_HEADING,
    body: QUOTE_BODY_V1,
    text: `${QUOTE_HEADING}\n${QUOTE_BODY_V1}`,
  };
}

export function getInvoiceTaxReductionDisclaimer(version: string = TAX_REDUCTION_TERMS_VERSION): string {
  void version;
  return INVOICE_DISCLAIMER_V1;
}

export function snapshotTaxReductionTerms(type: RotRut["type"]): TaxReductionTermsSnapshot {
  const t = getTaxReductionTerms(type);
  return {
    version: t.version,
    type,
    heading: t.heading,
    body: t.body,
    text: t.text,
  };
}

/** Enda skrivaren av systemgenererade ROT/RUT-villkor – anropas från offerttjänsten. */
export function taxReductionFields(rot: RotRut | null): {
  rot: RotRut | null;
  taxReductionTerms: TaxReductionTermsSnapshot | null;
} {
  return {
    rot,
    taxReductionTerms: rot ? snapshotTaxReductionTerms(rot.type) : null,
  };
}

export function taxReductionDeductionLabel(type: RotRut["type"]): string {
  return type === "rot" ? "Preliminärt ROT-avdrag" : "Preliminärt RUT-avdrag";
}

export function getDeniedReductionNotice(deniedAmount: number): string {
  return `Skatteverket godkände inte ${kr(deniedAmount)} av avdraget. Enligt ROT/RUT-villkoret återstår beloppet att betala av kunden.`;
}

export function deniedReductionDraftLabel(deniedAmount: number): string {
  return `Skapa fakturautkast ${kr(deniedAmount)}`;
}
