import { datumKort, kr } from "../format";
import {
  INBOX_AMOUNT_REVIEW,
  INBOX_ITEM_STATUS,
  PAYMENT_DETAILS_CAUSE,
  SUPPLIER_INVOICE_LIFECYCLE,
  supplierPaymentStatus,
} from "../status-labels";
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

/** Betalningsinstruktionens etikett – centrala vokabulären (status-labels.ts). */
export function supplierPaymentUiLabel(status: SupplierPaymentStatus, scheduledDate?: string): string {
  return supplierPaymentStatus(status, { scheduledDate, formatDate: datumKort }).label;
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
    return supplierPaymentStatus("FAILED");
  }
  if (payment?.status === "PAID" || invoice?.status === "betald") {
    return SUPPLIER_INVOICE_LIFECYCLE.BETALD;
  }
  if (payment && isPaymentInFlight(payment.status)) {
    // "Betalas 3 sep" – samma ord som Ekonomi-registret för samma instruktion.
    return supplierPaymentStatus(payment.status, { scheduledDate: payment.scheduledDate, formatDate: datumKort });
  }
  if (payment?.destinationChanged || detailsCause === "CHANGED") {
    return PAYMENT_DETAILS_CAUSE.CHANGED;
  }
  // Orsaksspecifik status i stället för ett generiskt "uppgifter saknas".
  if (invoice && detailsCause === "AWAITING_SUPPLIER") {
    return PAYMENT_DETAILS_CAUSE.AWAITING_SUPPLIER;
  }
  if (invoice?.accountingStatus === "bokford" && detailsCause === "EXTRACTION_UNCERTAIN") {
    return PAYMENT_DETAILS_CAUSE.EXTRACTION_UNCERTAIN;
  }
  if (invoice?.accountingStatus === "bokford" && detailsCause === "MISSING") {
    return PAYMENT_DETAILS_CAUSE.MISSING;
  }
  if (invoice && invoice.accountingStatus === "bokford" && !hasRecipientAccount(invoice, payment)) {
    return PAYMENT_DETAILS_CAUSE.MISSING;
  }
  if (item.parsedAmount == null && item.status === "ny" && !invoice) {
    return INBOX_AMOUNT_REVIEW;
  }
  if (invoice?.accountingStatus === "bokford" && (payment?.status === "READY" || payment?.status === "DRAFT")) {
    return SUPPLIER_INVOICE_LIFECYCLE.REDO_ATT_BETALA;
  }
  if (invoice?.accountingStatus === "bokford" && !payment) {
    // Ingen betalning är planerad ännu – lova inte "Betalas", säg förfallodatum.
    return hasRecipientAccount(invoice)
      ? { label: `Bokförd · Förfaller ${datumKort(invoice.dueDate)}`, tone: "info" }
      : PAYMENT_DETAILS_CAUSE.MISSING;
  }
  if (item.documentType === "kvitto" && item.status === "bokford") {
    return INBOX_ITEM_STATUS.bokford;
  }
  if (item.status === "bokford") return INBOX_ITEM_STATUS.bokford;
  if (item.status === "behandlad") return INBOX_ITEM_STATUS.behandlad;
  return INBOX_ITEM_STATUS.ny;
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

/** Nav-badge: ny, behöver granskas, eller väntar på godkännande att skicka till bank. */
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
