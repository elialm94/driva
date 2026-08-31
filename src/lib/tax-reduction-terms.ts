import type { RotRut, TaxReductionTermsSnapshot } from "./types";
import { kr } from "./format";
import { taxReductionCap, taxReductionRate } from "./calc";

/**
 * Central ROT/RUT-villkorstext.
 * Alla vyer (offert, offertdetalj, BankID, faktura, PDF) läser härifrån.
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

export function taxReductionSnapshotFromSubmitted(
  type: RotRut["type"],
  submitted: { heading?: string; body?: string }
): TaxReductionTermsSnapshot {
  const standard = getTaxReductionTerms(type);
  const heading = submitted.heading?.trim() || standard.heading;
  const body = submitted.body?.trim() || standard.body;
  return {
    version: standard.version,
    type,
    heading,
    body,
    text: `${heading}\n${body}`,
  };
}

/** True om heading+body skiljer sig från gällande standard för typen. */
export function isCustomTaxReductionTerms(
  snapshot: Pick<TaxReductionTermsText, "heading" | "body"> | null | undefined,
  type: RotRut["type"]
): boolean {
  if (!snapshot) return false;
  const standard = getTaxReductionTerms(type);
  return snapshot.heading !== standard.heading || snapshot.body !== standard.body;
}

export interface NextTaxReductionTermsInput {
  rot: RotRut | null;
  previous?: TaxReductionTermsSnapshot | null;
  submitted?: { heading?: string; body?: string } | null;
  resetToStandard?: boolean;
}

/**
 * Nästa ROT/RUT-villkorssnapshot. Data raderas inte när ROT slås av
 * (utkast behåller texten); den renderas bara när rot är valt.
 */
export function nextTaxReductionTerms({
  rot,
  previous,
  submitted,
  resetToStandard,
}: NextTaxReductionTermsInput): TaxReductionTermsSnapshot | null {
  if (!rot) return previous ?? null;
  if (resetToStandard) return snapshotTaxReductionTerms(rot.type);

  const hasSubmitted = Boolean(submitted && (submitted.heading != null || submitted.body != null));
  if (hasSubmitted) return taxReductionSnapshotFromSubmitted(rot.type, submitted!);

  if (!previous) return snapshotTaxReductionTerms(rot.type);

  if (previous.type !== rot.type) {
    if (isCustomTaxReductionTerms(previous, previous.type)) {
      return {
        ...previous,
        type: rot.type,
        text: `${previous.heading}\n${previous.body}`,
      };
    }
    return snapshotTaxReductionTerms(rot.type);
  }
  return previous;
}

/** Första aktivering utan tidigare snapshot. Använd nextTaxReductionTerms vid uppdatering. */
export function taxReductionFields(rot: RotRut | null): {
  rot: RotRut | null;
  taxReductionTerms: TaxReductionTermsSnapshot | null;
} {
  return {
    rot,
    taxReductionTerms: nextTaxReductionTerms({ rot, previous: null }),
  };
}

export function taxReductionDeductionLabel(type: RotRut["type"]): string {
  return type === "rot" ? "Preliminärt ROT-avdrag" : "Preliminärt RUT-avdrag";
}

export function taxReductionMaxLabel(type: RotRut["type"]): string {
  return type === "rot" ? "Maximalt preliminärt ROT-avdrag" : "Maximalt preliminärt RUT-avdrag";
}

export function taxReductionAppliedLabel(type: RotRut["type"]): string {
  return type === "rot" ? "ROT-avdrag att använda" : "RUT-avdrag att använda";
}

export function taxReductionExceedsMaxError(max: number, documentKind: "faktura" | "offert" = "faktura"): string {
  const doc = documentKind === "offert" ? "offerten" : "fakturan";
  return `Avdraget kan inte vara högre än maximalt ${kr(max)} för den här ${doc}.`;
}

export function taxReductionClampedMessage(
  type: RotRut["type"],
  applied: number,
  documentKind: "faktura" | "offert" = "faktura"
): string {
  const kind = type === "rot" ? "ROT" : "RUT";
  const whose = documentKind === "offert" ? "offertens" : "fakturans";
  return `${kind}-avdraget justerades till ${kr(applied)} eftersom ${whose} avdragsgrundande arbetskostnad ändrades.`;
}

export function taxReductionAmountHelp(documentKind: "faktura" | "offert" = "faktura"): string {
  const doc = documentKind === "offert" ? "offerten" : "fakturan";
  return `Driva visar det maximala avdrag som ${doc} medger. Sänk beloppet om kunden har mindre ROT/RUT-utrymme kvar.`;
}

export function taxReductionDocumentMaxLabel(documentKind: "faktura" | "offert", max: number): string {
  const doc = documentKind === "offert" ? "offerten" : "fakturan";
  return `Max för ${doc}: ${kr(max)}`;
}

export const TAX_REDUCTION_USE_MAX_LABEL = "Använd max";

/** Central copy för ”Hur räknas detta?” – procent och tak från tax config. */
export function taxReductionCalcHintText(type: RotRut["type"], laborInclVat: number): string {
  const percent = Math.round(taxReductionRate(type) * 100);
  return `Avdraget är ${percent} % av arbetskostnaden inkl. moms (${kr(laborInclVat)}). Bara rader markerade som arbete räknas – material, resor och övrigt ingår inte. Högst ${kr(taxReductionCap(type))} per person och år. Beloppet räknas av systemet och är inte en rabatt.`;
}

export function getDeniedReductionNotice(deniedAmount: number): string {
  return `Skatteverket godkände inte ${kr(deniedAmount)} av avdraget. Enligt ROT/RUT-villkoret återstår beloppet att betala av kunden.`;
}

export function deniedReductionDraftLabel(deniedAmount: number): string {
  return `Skapa fakturautkast ${kr(deniedAmount)}`;
}
