import { save } from "../store";
import { MAIL_NOT_CONFIGURED, type MailResult } from "../mail";
import { missingEmailForSend } from "../customer-validation";
import {
  INVOICE_SEND_FAILED,
  QUOTE_SEND_FAILED,
  REMINDER_SEND_FAILED,
  sendInvoice as sendInvoiceEmail,
  sendPaymentReminder,
  sendQuote as sendQuoteEmail,
  sendQuoteFollowUp,
  userFacingSendError,
} from "../email/service";
import { currentVersion, getInvoice, getQuote, invoiceOutstanding, invoiceTotals, quoteTotals, requireCustomer } from "./data";
import { deliverInvoice, issueInvoice, sendReminder, type Actor } from "./invoices";
import { publicToken } from "../ids";
import { followUpQuote, assertQuoteReadyToSend, sendQuote } from "./quotes";

/**
 * E-postleverans av offerter, fakturor och påminnelser.
 *
 * Ordning: validera → Resend → provider-succé/messageId → persist sent.
 * Misslyckad leverans markerar aldrig dokumentet som skickat.
 * PDF: samma generator som /api/offerter|fakturor/[id]/pdf (quotePdfAttachment).
 * Mejlet skickar länk i dag; SMS skickar bara säker länk, aldrig PDF-bilaga.
 */

export type DeliveryOutcome = {
  mode: MailResult["mode"] | "live";
  ok: boolean;
  error?: string;
  messageId?: string;
  sentTo?: string;
};

const documentLocks = new Map<string, Promise<{ outcome: DeliveryOutcome }>>();

function withDocumentLock(key: string, fn: () => Promise<{ outcome: DeliveryOutcome }>): Promise<{ outcome: DeliveryOutcome }> {
  const existing = documentLocks.get(key);
  if (existing) return existing;
  const pending = fn().finally(() => documentLocks.delete(key));
  documentLocks.set(key, pending);
  return pending;
}

function requireRecipient(email: string | undefined): string | { error: string } {
  const to = email?.trim() ?? "";
  if (missingEmailForSend({ email: to })) {
    return { error: "Kunden saknar e-postadress. Lägg till den innan du skickar." };
  }
  return to;
}

function recordAttempt(kind: "quote" | "invoice", id: string): void {
  if (kind === "quote") {
    const quote = getQuote(id);
    if (quote) quote.lastSendAttemptAt = new Date().toISOString();
  } else {
    const invoice = getInvoice(id);
    if (invoice) invoice.lastSendAttemptAt = new Date().toISOString();
  }
  save();
}

function toOutcome(result: MailResult, to: string, fallback: string): DeliveryOutcome {
  if (result.ok) {
    return { mode: result.mode, ok: true, messageId: result.messageId, sentTo: to };
  }
  return { mode: result.mode, ok: false, error: userFacingSendError(result, fallback) };
}

/** Skicka offerten: Resend först, därefter status skickad. */
export async function sendQuoteWithEmail(quoteId: string): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`quote:${quoteId}`, () => sendQuoteWithEmailOnce(quoteId));
}

async function sendQuoteWithEmailOnce(quoteId: string): Promise<{ outcome: DeliveryOutcome }> {
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Offerten finns inte");
  if (quote.status === "skickad" && quote.sentAt) {
    return {
      outcome: {
        mode: "live",
        ok: true,
        messageId: quote.lastEmail?.messageId,
        sentTo: quote.lastEmail?.sentTo,
      },
    };
  }
  assertQuoteReadyToSend(quoteId);
  const customer = requireCustomer(quote.customerId);
  const to = requireRecipient(customer.email);
  if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
  if (!quote.token) {
    quote.token = publicToken();
    save();
  }

  const version = currentVersion(quote);
  const t = quoteTotals(quote);
  recordAttempt("quote", quoteId);
  const result = await sendQuoteEmail({
    to,
    quoteId,
    quoteNumber: quote.number,
    title: version.title,
    customerName: customer.name,
    amount: t.toPay,
    validUntil: version.validUntil,
    token: quote.token,
    bankidEnabled: true,
  });
  const outcome = toOutcome(result, to, QUOTE_SEND_FAILED);
  if (outcome.ok) {
    sendQuote(quoteId, {
      mode: result.ok ? result.mode : "live",
      ok: true,
      messageId: outcome.messageId,
      sentTo: to,
    });
  }
  return { outcome };
}

/** Utfärda (nummer + snapshot + bokföring) och e-posta fakturan. Leveransfel rullar aldrig tillbaka utfärdandet. */
export async function issueAndEmailInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  issueInvoice(invoiceId, createdBy);
  return emailInvoice(invoiceId, createdBy);
}

/** E-posta en utfärdad faktura (första gången eller igen). */
export async function emailInvoice(invoiceId: string, createdBy: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`invoice:${invoiceId}`, () => emailInvoiceOnce(invoiceId, createdBy));
}

async function emailInvoiceOnce(invoiceId: string, createdBy: Actor): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status === "utkast") throw new Error("Utkast kan inte skickas innan fakturan är utfärdad.");
  if (invoice.number == null || !invoice.ocr) {
    throw new Error("Fakturan kunde inte skickas – nummer och OCR saknas. Försök igen.");
  }
  const customer = requireCustomer(invoice.customerId);
  const to = requireRecipient(customer.email);
  if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
  const t = invoiceTotals(invoice);

  recordAttempt("invoice", invoiceId);
  const result = await sendInvoiceEmail({
    to,
    invoiceId,
    invoiceNumber: invoice.number,
    customerName: customer.name,
    amount: t.toPay,
    dueDate: invoice.dueDate,
    token: invoice.token,
    ocr: invoice.ocr,
  });
  const outcome = toOutcome(result, to, INVOICE_SEND_FAILED);
  if (outcome.ok) {
    deliverInvoice(invoiceId, createdBy, {
      mode: result.ok ? result.mode : "live",
      ok: true,
      messageId: outcome.messageId,
      sentTo: to,
    });
  } else {
    const { logActivity } = await import("./activity");
    logActivity(`Faktura #${invoice.number} kunde inte e-postas till ${customer.name}.`, {
      customerId: customer.id,
      entity: { type: "faktura", id: invoice.id },
      createdBy,
    });
  }
  return { outcome };
}

/** E-posta betalningspåminnelse för en försenad faktura. */
export async function remindInvoiceByEmail(invoiceId: string, by: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`invoice-reminder:${invoiceId}`, () => remindInvoiceByEmailOnce(invoiceId, by));
}

async function remindInvoiceByEmailOnce(invoiceId: string, by: Actor): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice || !(invoice.status === "skickad" || invoice.status === "delbetald") || invoice.type === "kredit") {
    return { outcome: { mode: "live", ok: false, error: "Fakturan kan inte påminnas." } };
  }
  if (!invoice.sentAt || invoice.number == null) {
    return { outcome: { mode: "live", ok: false, error: "Fakturan måste ha skickats innan en påminnelse kan gå ut." } };
  }
  const customer = requireCustomer(invoice.customerId);
  const to = requireRecipient(customer.email);
  if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
  const due = invoiceOutstanding(invoice);
  const t = invoiceTotals(invoice);

  recordAttempt("invoice", invoiceId);
  const result = await sendPaymentReminder({
    to,
    invoiceId,
    invoiceNumber: invoice.number,
    customerName: customer.name,
    amount: t.toPay,
    outstanding: due,
    dueDate: invoice.dueDate,
    token: invoice.token,
    ocr: invoice.ocr,
    partial: invoice.status === "delbetald",
  });
  const outcome = toOutcome(result, to, REMINDER_SEND_FAILED);
  if (outcome.ok) {
    sendReminder(invoiceId, by, {
      mode: result.ok ? result.mode : "live",
      ok: true,
      messageId: outcome.messageId,
      sentTo: to,
    });
  }
  return { outcome };
}

/** E-posta en påminnelse om en obesvarad offert. */
export async function followUpQuoteByEmail(quoteId: string, by: "anvandare" | "assistent" = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  const quote = getQuote(quoteId);
  if (!quote || quote.status !== "skickad") {
    return { outcome: { mode: "live", ok: false, error: "Offerten väntar inte på svar." } };
  }
  const customer = requireCustomer(quote.customerId);
  const to = requireRecipient(customer.email);
  if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
  const version = currentVersion(quote);

  recordAttempt("quote", quoteId);
  const result = await sendQuoteFollowUp({
    to,
    quoteId,
    quoteNumber: quote.number,
    title: version.title,
    customerName: customer.name,
    validUntil: version.validUntil,
    token: quote.token,
  });
  const outcome = toOutcome(result, to, REMINDER_SEND_FAILED);
  if (outcome.ok) followUpQuote(quoteId, by, { mode: result.ok ? result.mode : "live", ok: true });
  return { outcome };
}

export { MAIL_NOT_CONFIGURED };
