import { datumKort, kr } from "../format";
import type { PaymentDetailsCause } from "../services/payment-details";
import type {
  InboxDocumentType,
  InboxItem,
  SupplierInvoice,
  SupplierPayment,
  SupplierPaymentStatus,
} from "../types";

export type InboxStatusTone = "neutral" | "info" | "ok" | "warn" | "danger";

export interface InboxDisplayStatus {
  label: string;
  tone: InboxStatusTone;
}

const IN_FLIGHT: ReadonlySet<SupplierPaymentStatus> = new Set([
  "SUBMITTED_TO_BANK",
  "AWAITING_APPROVAL",
  "SCHEDULED",
]);

export function isPaymentInFlight(status: SupplierPaymentStatus): boolean {
  return IN_FLIGHT.has(status);
}

export function supplierPaymentUiLabel(status: SupplierPaymentStatus, scheduledDate?: string): string {
  switch (status) {
    case "DRAFT":
    case "READY":
      return "Redo att betalas";
    case "SUBMITTED_TO_BANK":
    case "AWAITING_APPROVAL":
      return "Skickad till bank";
    case "SCHEDULED":
      return scheduledDate ? `Bokförd · Betalas ${datumKort(scheduledDate)}` : "Schemalagd";
    case "PAID":
      return "Betald";
    case "FAILED":
      return "Betalningen misslyckades";
    case "CANCELLED":
      return "Avbruten";
  }
}

export function classifyEconomicDocument(input: {
  subject?: string;
  text?: string;
  invoiceNumber?: string;
  dueDate?: string;
  ocr?: string;
  bankgiro?: string;
  documentType?: InboxDocumentType;
}): InboxDocumentType {
  if (input.documentType) return input.documentType;
  if (input.invoiceNumber || input.dueDate || input.ocr || input.bankgiro) return "leverantorsfaktura";
  const hay = `${input.subject ?? ""} ${input.text ?? ""}`;
  if (/faktura/i.test(hay)) return "leverantorsfaktura";
  if (/kvitto/i.test(hay)) return "kvitto";
  return "ekonomiskt_dokument";
}

export function inboxDocumentTitle(item: InboxItem, invoice?: SupplierInvoice): string {
  const supplier = invoice?.supplier ?? item.parsedSupplier;
  const number = invoice?.invoiceNumber ?? item.parsedInvoiceNumber;
  const amount = invoice?.amount ?? item.parsedAmount;
  if (item.documentType === "kvitto") {
    const who = supplier ?? item.fromAddress;
    return amount != null ? `Kvitto ${who} · ${kr(amount)}` : `Kvitto ${who}`;
  }
  if (number && amount != null) return `Faktura ${number} · ${kr(amount)}`;
  if (amount != null) return `Dokument · ${kr(amount)}`;
  return item.subject?.trim() || "Ekonomiskt dokument";
}

export function needsAmountReview(item: InboxItem): boolean {
  return item.parsedAmount == null && item.documentType !== "kvitto" ? item.status === "ny" : false;
}

export function inboxDisplayStatus(input: {
  item: InboxItem;
  invoice?: SupplierInvoice;
  payment?: SupplierPayment;
  /** Härledd orsak för betalningsuppgifterna (services/payment-details) – ger orsaksspecifika etiketter. */
  detailsCause?: PaymentDetailsCause;
}): InboxDisplayStatus {
  const { item, invoice, payment, detailsCause } = input;

  if (payment?.status === "FAILED") {
    return { label: "Betalningen misslyckades", tone: "danger" };
  }
  if (payment?.status === "PAID" || invoice?.status === "betald") {
    return { label: "Betald", tone: "ok" };
  }
  if (payment && isPaymentInFlight(payment.status)) {
    if (payment.status === "SCHEDULED") {
      return { label: `Bokförd · Betalas ${datumKort(payment.scheduledDate)}`, tone: "info" };
    }
    return { label: "Skickad till bank", tone: "info" };
  }
  if (payment?.destinationChanged || detailsCause === "CHANGED") {
    return { label: "Kontrollera bankuppgifter", tone: "danger" };
  }
  // Orsaksspecifik status i stället för ett generiskt "Saknar bankuppgifter".
  if (invoice && detailsCause === "AWAITING_SUPPLIER") {
    return { label: "Väntar på leverantören", tone: "info" };
  }
  if (invoice?.accountingStatus === "bokford" && detailsCause === "EXTRACTION_UNCERTAIN") {
    return { label: "Kontrollera betalningsuppgifter", tone: "warn" };
  }
  if (invoice?.accountingStatus === "bokford" && detailsCause === "MISSING") {
    return { label: "Väntar på betalningsuppgifter", tone: "warn" };
  }
  if (invoice && invoice.accountingStatus === "bokford" && !hasRecipientAccount(invoice, payment)) {
    return { label: "Saknar bankuppgifter", tone: "warn" };
  }
  if (item.parsedAmount == null && item.status === "ny" && !invoice) {
    return { label: "Kontrollera belopp", tone: "warn" };
  }
  if (invoice?.accountingStatus === "bokford" && (payment?.status === "READY" || payment?.status === "DRAFT")) {
    return { label: "Redo att betalas", tone: "warn" };
  }
  if (invoice?.accountingStatus === "bokford" && !payment) {
    return hasRecipientAccount(invoice)
      ? { label: `Bokförd · Betalas ${datumKort(invoice.dueDate)}`, tone: "info" }
      : { label: "Saknar bankuppgifter", tone: "warn" };
  }
  if (item.documentType === "kvitto" && item.status === "bokford") {
    return { label: "Bokförd", tone: "ok" };
  }
  if (item.status === "bokford") return { label: "Bokförd", tone: "ok" };
  if (item.status === "behandlad") return { label: "Behandlad", tone: "neutral" };
  return { label: "Ny", tone: "info" };
}

export function hasRecipientAccount(invoice?: SupplierInvoice, payment?: SupplierPayment): boolean {
  const account = (payment?.recipientAccount ?? invoice?.recipientAccount ?? invoice?.bankgiro ?? "").replace(/\s+/g, "");
  return account.length >= 4;
}

/**
 * Öppna = behöver kompletteras, är redo att betalas, eller betalningen misslyckades.
 * Skickad/schemalagd/betald är hanterad historik (följs på På gång / Ekonomi).
 */
export function isInboxItemOpen(input: {
  item: InboxItem;
  invoice?: SupplierInvoice;
  payment?: SupplierPayment;
}): boolean {
  const { item, invoice, payment } = input;
  if (payment?.status === "FAILED") return true;
  if (payment?.status === "PAID" || invoice?.status === "betald") return false;
  if (payment && isPaymentInFlight(payment.status)) return false;
  if (item.documentType === "kvitto") {
    return item.status === "ny" || (item.status !== "bokford" && !item.expenseId);
  }
  if (payment?.status === "READY" || payment?.status === "DRAFT") return true;
  if (invoice?.accountingStatus === "bokford" && !hasRecipientAccount(invoice, payment)) return true;
  if (item.status === "ny") return true;
  if (invoice && invoice.accountingStatus !== "bokford") return true;
  return false;
}

/**
 * Inbox-badge och Inbox-listans "väntar på dig" – samma definition överallt.
 *
 * Räknas: saker som väntar på ANVÄNDAREN nu.
 *   – ny post som inte är bokförd, eller belopp som måste granskas
 *   – saknade/ändrade betalningsuppgifter (inte när vi väntar på leverantören)
 *   – misslyckad betalning
 *   – redo att godkännas för bank nu (förfallen eller inom 2 dagar)
 *
 * Räknas inte: betald, bankfil skapad, skickad/schemalagd, väntan på
 * leverantören, framtida förfallodatum mer än 2 dagar bort.
 */
export function countsTowardInboxBadge(input: {
  item: InboxItem;
  invoice?: SupplierInvoice;
  payment?: SupplierPayment;
  detailsCause?: PaymentDetailsCause;
  now?: Date;
}): boolean {
  const { item, invoice, payment, detailsCause } = input;
  if (payment?.status === "FAILED" || payment?.destinationChanged || detailsCause === "CHANGED") return true;
  if (item.status === "ny" && (!invoice || invoice.accountingStatus !== "bokford" || item.parsedAmount == null)) {
    return true;
  }
  // Väntar på leverantören = extern part, inget för användaren att göra nu.
  if (detailsCause === "AWAITING_SUPPLIER") return false;
  if (invoice?.accountingStatus === "bokford" && !hasRecipientAccount(invoice, payment)) return true;
  if (isReadyToApproveNow({ invoice, payment, now: input.now })) return true;
  return false;
}

/** Redo att godkännas nu: bokförd, komplett, inte skickad, och förfallen eller nära. */
export function isReadyToApproveNow(input: {
  invoice?: SupplierInvoice;
  payment?: SupplierPayment;
  now?: Date;
}): boolean {
  const { invoice, payment, now = new Date() } = input;
  if (!invoice || invoice.accountingStatus !== "bokford" || invoice.status === "betald") return false;
  if (payment && isPaymentInFlight(payment.status)) return false;
  if (payment?.status === "PAID" || payment?.status === "CANCELLED") return false;
  if (!hasRecipientAccount(invoice, payment)) return false;
  if (payment?.destinationChanged) return false;
  const due = (payment?.scheduledDate ?? invoice.dueDate).slice(0, 10);
  const days = daysFrom(now, due);
  return days <= 2;
}

function daysFrom(now: Date, iso: string): number {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const target = new Date(`${iso.slice(0, 10)}T00:00:00`);
  return Math.round((target.getTime() - start.getTime()) / 86_400_000);
}

export function normalizeRecipientAccount(value: string): string {
  return value.replace(/[\s-]/g, "").toLowerCase();
}
