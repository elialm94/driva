import type { CompanySettings, Customer, DocLine, HousingDetails, Invoice, TaxReductionDetails } from "../types";
import { docTotals } from "../calc";
import { kr, datumLang } from "../format";
import { formatWorkPeriodRange } from "../tax-reduction-gaps";
import { normalizePersonnummer } from "../personnummer";
import { taxReductionDeductionLabel } from "../tax-reduction-terms";
import { lineKindLabel } from "../economic-line-type";
import { getWorkLocation, workLocationToHousing } from "../services/work-locations";

/**
 * Vy-modell för fakturadokumentet – delas av webbvyn och PDF/A4.
 *
 * Snapshotpolicy: utfärdade fakturor läser ALLT härifrån ur issuedSnapshot
 * (personnummer, fastighet, period, belopp) – aldrig live-uppslag mot dagens
 * kundkort. Utkast läser live (utkast är per definition en live-förhandsbild).
 */

export interface DocInfoRow {
  label: string;
  value: string;
}

export interface InvoiceTaxReductionDocView {
  type: "rot" | "rut";
  /** "ROT-avdrag" / "RUT-avdrag" – dokumentets sektionsrubrik. */
  heading: string;
  /** Personen som skattereduktionen avser. */
  personName: string;
  /** Normaliserat personnummer. Saknas → raden visas inte. */
  personalIdentityNumber?: string;
  /** Fastighet/BRF-rader – endast fält med värde. */
  propertyRows: DocInfoRow[];
  /** "Utförandedatum: 9 augusti 2026" eller "Arbetsperiod: 12–19 augusti 2026". */
  periodRow?: DocInfoRow;
  /** Underlag för avdraget (arbetskostnad inkl. moms). */
  laborInclVat: number;
  /** Preliminärt avdrag som dras på dokumentet. */
  deduction: number;
  deductionLabel: string;
}

function housingRows(housing?: HousingDetails | null): DocInfoRow[] {
  if (!housing?.dwellingType) return [];
  if (housing.dwellingType === "smahus") {
    const designation = housing.propertyDesignation?.trim();
    return designation ? [{ label: "Fastighet", value: designation }] : [];
  }
  const rows: DocInfoRow[] = [];
  if (housing.brfOrgNumber?.trim()) rows.push({ label: "Bostadsrättsförening", value: housing.brfOrgNumber.trim() });
  if (housing.apartmentNumber?.trim()) rows.push({ label: "Lägenhetsnummer", value: housing.apartmentNumber.trim() });
  return rows;
}

function hasHousingContent(housing?: HousingDetails | null): boolean {
  return housingRows(housing).length > 0;
}

function periodRow(details: TaxReductionDetails | null | undefined, serviceDate?: string): DocInfoRow | undefined {
  const start = details?.workPeriodStart?.slice(0, 10) || "";
  const end = details?.workPeriodEnd?.slice(0, 10) || "";
  if (start && end && start !== end) {
    return { label: "Arbetsperiod", value: formatWorkPeriodRange(start, end) };
  }
  const single = serviceDate?.slice(0, 10) || end || start;
  if (!single) return undefined;
  return { label: "Utförandedatum", value: datumLang(single) };
}

/**
 * ROT/RUT-sektionens data för dokumentet. Utfärdad faktura: allt ur
 * issuedSnapshot (frusen person, fastighet och period). Utkast: fakturans
 * egna taxReductionDetails, med fallback till bostaden som är vald på
 * fakturan (workLocationId) – aldrig kundens standardbostad.
 */
export function invoiceTaxReductionView(
  invoice: Invoice,
  live: { buyer: Customer }
): InvoiceTaxReductionDocView | null {
  const snap = invoice.status !== "utkast" ? invoice.issuedSnapshot : undefined;
  const rot = snap ? snap.rot : invoice.rot;
  if (!rot) return null;

  const lines = snap?.lines ?? invoice.lines;
  const totals = docTotals(lines, rot);
  const details = snap ? (snap.taxReductionDetails ?? null) : (invoice.taxReductionDetails ?? null);

  let housing = details?.housing ?? null;
  if (!snap && !hasHousingContent(housing)) {
    // Utkast utan ifyllda bostadsuppgifter: läs fakturans valda bostad.
    const location = getWorkLocation(live.buyer, invoice.workLocationId);
    if (location) housing = workLocationToHousing(location);
  }

  const pn = snap ? snap.buyer.personalIdentityNumber : live.buyer.personalIdentityNumber;

  return {
    type: rot.type,
    heading: rot.type === "rot" ? "ROT-avdrag" : "RUT-avdrag",
    personName: snap ? snap.buyer.name : live.buyer.name,
    personalIdentityNumber: pn?.trim() ? normalizePersonnummer(pn) : undefined,
    propertyRows: housingRows(housing),
    periodRow: periodRow(details, snap ? snap.serviceDate : invoice.serviceDate),
    laborInclVat: totals.laborInclVat,
    deduction: totals.deduction,
    deductionLabel: taxReductionDeductionLabel(rot.type),
  };
}

/**
 * Betalningsuppgifter som kompakta dokumentrader – endast fält med värde.
 * Bankkonto visas bara när IBAN saknas (samma regel som tidigare dokument).
 */
export function invoicePaymentRows(input: {
  seller: Pick<CompanySettings, "bankgiro" | "plusgiro" | "bankAccount" | "iban" | "bic">;
  ocr: string;
  dueDate: string;
  amount: number;
}): DocInfoRow[] {
  const rows: DocInfoRow[] = [];
  const { seller } = input;
  if (seller.bankgiro?.trim()) rows.push({ label: "Bankgiro", value: seller.bankgiro.trim() });
  if (seller.plusgiro?.trim()) rows.push({ label: "PlusGiro", value: seller.plusgiro.trim() });
  if (seller.iban?.trim()) {
    rows.push({ label: "IBAN", value: seller.iban.trim() });
    if (seller.bic?.trim()) rows.push({ label: "BIC", value: seller.bic.trim() });
  } else if (seller.bankAccount?.trim()) {
    rows.push({ label: "Bankkonto", value: seller.bankAccount.trim() });
  }
  if (input.ocr.trim()) rows.push({ label: "OCR", value: input.ocr.trim() });
  rows.push({ label: "Förfallodatum", value: datumLang(input.dueDate) });
  rows.push({ label: "Belopp", value: kr(input.amount) });
  return rows;
}

/** "Betalningsvillkor: 30 dagar · Dröjsmålsränta: 10 % per år" – kompakt dokumentdata. */
export function invoicePaymentTermsLine(doc: Pick<Invoice, "paymentTermsDays" | "lateInterestRate">): string {
  const parts = [`Betalningsvillkor: ${doc.paymentTermsDays} dagar`];
  if (doc.lateInterestRate) parts.push(`Dröjsmålsränta: ${doc.lateInterestRate} % per år`);
  return parts.join(" · ");
}

/** Offertnummer som fakturan avser – ur radernas proveniens (frusen i snapshot). */
export function invoiceQuoteReference(lines: DocLine[]): number | undefined {
  return lines.find((line) => line.sourceQuoteNumber != null)?.sourceQuoteNumber;
}

/**
 * Radtyp under beskrivningen – bara när den tillför något. "Arbete / Arbete"
 * är redundant; "Montering / Arbete" förklarar ROT-underlaget. Ändrar aldrig
 * lagrad kind/type (de styr ROT/RUT-beräkningen).
 */
export function lineTypeNote(line: Pick<DocLine, "kind" | "description">): string | null {
  const label = lineKindLabel(line.kind);
  const description = line.description.trim().toLowerCase();
  const norm = label.toLowerCase();
  if (description === norm) return null;
  // "Arbete – montering av kök" börjar redan med typen → visa inte igen.
  if (description.startsWith(norm)) {
    const next = description.charAt(norm.length);
    if (!next || !/\p{L}/u.test(next)) return null;
  }
  return label;
}
