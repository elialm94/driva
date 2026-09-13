/**
 * Typer som klient-UI får importera. Inga store/fs-beroenden –
 * servicefilerna re-exporterar samma namn.
 */
import { kr } from "./format";
import type { Invoice, JobPricingKind, Quote } from "./types";

export type JobQuoteAction = "skapa_offert" | "visa_offert" | "fortsatt_offert";
export type JobInvoiceAction = "skapa_faktura" | "skapa_delfaktura" | "skapa_slutfaktura";
export type JobPrimaryKind = JobQuoteAction | JobInvoiceAction;
export type JobSecondaryKind = JobQuoteAction | JobInvoiceAction | "redigera";

/**
 * Uppdragssidans enda huvudknapp. Offertutkastet går först (den är inte
 * skickad än), sedan det som går att fakturera, sedan offerten.
 * "Avsluta uppdrag" är aldrig huvudknapp - den bor i "…"-menyn.
 */
export function jobHeaderPrimary(state: {
  quoteAction: JobQuoteAction;
  invoiceAction: JobInvoiceAction;
  hasBillable: boolean;
}): JobPrimaryKind {
  if (state.quoteAction === "fortsatt_offert") return "fortsatt_offert";
  if (state.hasBillable) return state.invoiceAction;
  if (state.quoteAction === "skapa_offert") return "skapa_offert";
  return "visa_offert";
}

export type JobInvoiceOptionBasis = "quote" | "actuals" | "empty";
export type JobInvoiceBasis = "quote" | "actuals" | "quote_plus_extras" | "empty";

export interface JobInvoiceOption {
  basis: JobInvoiceOptionBasis;
  title: string;
  hint: string;
  amount: number;
  recommended?: boolean;
  extrasAmount?: number;
}

export interface JobInvoiceChoice {
  pricingKind: JobPricingKind;
  options: JobInvoiceOption[];
  recommendedBasis: JobInvoiceOptionBasis | null;
  /** Finns bara ett rimligt underlag – hoppa över valet. */
  autoBasis: JobInvoiceOptionBasis | null;
  warning?: { excess: number; tillaggHref: string };
  tillaggHref: string;
  unapprovedQuoteNotice?: string;
}

export interface JobWorkComparison {
  hasQuote: boolean;
  quoteNumber?: number;
  laborHoursQuoted: number;
  laborHoursRegistered: number;
  laborHoursDelta: number;
  materialQuotedExcl: number;
  materialRegisteredExcl: number;
  quotedExcl: number;
  registeredExcl: number;
  deltaExcl: number;
  extrasCount: number;
  overageLabel: string | null;
}

export interface JobCompleteWarning {
  remaining: number;
  registeredUninvoiced: number;
  openDraftCount: number;
  openDraftAmount: number;
  unresolvedActionCount: number;
  shouldWarn: boolean;
}

export type JobRemovalKind = "delete" | "archive";

export interface JobRemovalPolicy {
  kind: JobRemovalKind;
  reasons: string[];
  /** En rad till varför Ta bort är avstängd. Tom när uppdraget får raderas. */
  disabledReason: string | null;
}

/** En svensk rad: utfärdad faktura vinner över godkänd offert. */
export function jobRemovalDisabledReason(reasons: string[]): string | null {
  if (reasons.length === 0) return null;
  if (reasons.includes("Utfärdad faktura")) return "Uppdraget har en utfärdad faktura.";
  if (reasons.includes("Godkänd offert")) return "Uppdraget har en godkänd offert.";
  return `Uppdraget har ${reasons[0].toLowerCase()}.`;
}

/** Rubrik på offertraden i uppdragets Ekonomi - utkast är inte Avtalat. */
export function jobQuoteCardHeading(quote: Pick<Quote, "number" | "status">, amount: number): string {
  if (quote.status === "utkast") return `Offert utkast ${kr(amount)}`;
  return `Offert #${quote.number} · ${kr(amount)}`;
}

/** Chip på arbetsraden: vilket dokument raden ligger på. */
export function jobWorkInvoiceChipLabel(input: {
  status: "uninvoiced" | "draft" | "invoiced";
  invoiceNumber?: number | null;
  invoiceAmount?: number;
  invoiceTitle?: string;
}): string {
  if (input.status === "uninvoiced") return "Ej fakturerad";
  if (input.status === "invoiced") {
    return input.invoiceNumber != null ? `På faktura #${input.invoiceNumber}` : "På faktura";
  }
  const detail =
    input.invoiceAmount != null ? kr(input.invoiceAmount) : input.invoiceTitle?.trim() || "";
  return detail ? `På utkast · ${detail}` : "På utkast";
}

/** Papperskorgen i Ekonomi-listan: bara offert-/fakturautkast, aldrig kredit. */
export function jobEconomyDocCanDiscard(doc: {
  kind: "quote" | "invoice";
  status: Quote["status"] | Invoice["status"];
  type?: Invoice["type"];
}): boolean {
  if (doc.status !== "utkast") return false;
  if (doc.kind === "invoice" && doc.type === "kredit") return false;
  return true;
}
