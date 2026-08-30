/**
 * Typer som klient-UI får importera. Inga store/fs-beroenden –
 * servicefilerna re-exporterar samma namn.
 */
import type { JobPricingKind } from "./types";

export type JobQuoteAction = "skapa_offert" | "visa_offert" | "fortsatt_offert";
export type JobInvoiceAction = "skapa_faktura" | "skapa_delfaktura" | "skapa_slutfaktura";
export type JobPrimaryKind = JobQuoteAction | JobInvoiceAction;
export type JobSecondaryKind = JobQuoteAction | JobInvoiceAction | "redigera";

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
}
