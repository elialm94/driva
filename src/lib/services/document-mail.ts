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
import { kr } from "../format";
import { currentVersion, getInvoice, getQuote, invoiceOutstanding, invoiceTotals, quoteTotals, requireCustomer } from "./data";
import { deliverInvoice, issueInvoice, sendReminder, type Actor } from "./invoices";
import { publicToken } from "../ids";
import { followUpQuote, assertQuoteReadyToSend, sendQuote } from "./quotes";
import { sendSms, type SmsResult } from "../sms/service";
import { invoiceReminderSmsText, invoiceSmsText, quoteSmsText } from "../sms/messages";
import {
  atLeastOneChannel,
  normalizeSelectedChannels,
  partialSuccessMessage,
  recipientE164,
  type SelectedChannels,
} from "../sms/channels";
import { appendDelivery } from "./deliveries";
import { logActivity } from "./activity";
import type { DocumentDelivery, DeliveryProvider, Invoice, Quote } from "../types";

/**
 * E-post- och SMS-leverans av offerter, fakturor och påminnelser.
 *
 * Ordning: validera → provider → persist sent vid minst en succé.
 * Misslyckad kanal rullar inte tillbaka en lyckad.
 */

export type DeliveryOutcome = {
  mode: MailResult["mode"] | "live";
  ok: boolean;
  error?: string;
  messageId?: string;
  sentTo?: string;
  warning?: string;
  email?: DeliveryOutcome;
  sms?: DeliveryOutcome;
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

function smsToOutcome(result: SmsResult, to: string): DeliveryOutcome {
  if (result.ok) {
    return { mode: result.mode, ok: true, messageId: result.providerMessageId, sentTo: to };
  }
  return { mode: result.mode, ok: false, error: result.error };
}

function mailProvider(mode: MailResult["mode"]): DeliveryProvider {
  if (mode === "demo") return "demo";
  if (mode === "test") return "test";
  if (mode === "mock") return "mock";
  return "resend";
}

function smsProvider(mode: SmsResult["mode"]): DeliveryProvider {
  if (mode === "demo") return "demo";
  if (mode === "test") return "test";
  if (mode === "mock") return "mock";
  return "46elks";
}

function persistDelivery(
  doc: Quote | Invoice,
  input: {
    channel: DocumentDelivery["channel"];
    kind: DocumentDelivery["kind"];
    destination: string;
    outcome: DeliveryOutcome;
    at: string;
  }
): void {
  const delivery: DocumentDelivery = {
    channel: input.channel,
    kind: input.kind,
    destination: input.destination,
    provider: input.channel === "SMS" ? smsProvider(input.outcome.mode) : mailProvider(input.outcome.mode),
    status: input.outcome.ok ? "sent" : "failed",
    ...(input.outcome.messageId ? { providerMessageId: input.outcome.messageId } : {}),
    ...(input.outcome.ok ? { sentAt: input.at } : { failedAt: input.at }),
  };
  appendDelivery(doc, delivery);
}

function combineOutcomes(email?: DeliveryOutcome, sms?: DeliveryOutcome): DeliveryOutcome {
  const anyOk = Boolean(email?.ok || sms?.ok);
  const warning = email && sms ? partialSuccessMessage(email.ok, sms.ok) : undefined;
  const primary = email?.ok ? email : sms?.ok ? sms : email ?? sms;
  const error = anyOk
    ? undefined
    : email?.error && sms?.error && email.error !== sms.error
      ? `${email.error} ${sms.error}`
      : primary?.error;
  return {
    ok: anyOk,
    mode: primary?.mode ?? "live",
    messageId: email?.messageId ?? sms?.messageId,
    sentTo: email?.sentTo ?? sms?.sentTo,
    error,
    warning,
    email,
    sms,
  };
}

function resolveChannels(
  requested: SelectedChannels | undefined,
  customer: { email?: string | null; phone?: string | null }
): SelectedChannels | { error: string } {
  const channels = normalizeSelectedChannels(requested, customer);
  if (!atLeastOneChannel(channels)) {
    return { error: "Välj minst ett leveranssätt." };
  }
  return channels;
}

/** Skicka offerten: valda kanaler, därefter status skickad vid minst en succé. */
export async function sendQuoteWithChannels(
  quoteId: string,
  channels?: SelectedChannels
): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`quote:${quoteId}`, () => sendQuoteWithChannelsOnce(quoteId, channels));
}

/** Bakåtkompatibelt e-postutskick (assistent, äldre tester). */
export async function sendQuoteWithEmail(quoteId: string): Promise<{ outcome: DeliveryOutcome }> {
  return sendQuoteWithChannels(quoteId, { email: true, sms: false });
}

async function sendQuoteWithChannelsOnce(
  quoteId: string,
  requested?: SelectedChannels
): Promise<{ outcome: DeliveryOutcome }> {
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
  const channels = resolveChannels(requested, customer);
  if ("error" in channels) return { outcome: { mode: "live", ok: false, error: channels.error } };

  let emailTo: string | undefined;
  if (channels.email) {
    const to = requireRecipient(customer.email);
    if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
    emailTo = to;
  }

  let smsTo: string | undefined;
  if (channels.sms) {
    const parsed = recipientE164(customer.phone);
    if (!parsed.ok) return { outcome: { mode: "live", ok: false, error: parsed.error } };
    smsTo = parsed.to;
  }

  if (!quote.token) {
    quote.token = publicToken();
    save();
  }

  const version = currentVersion(quote);
  const t = quoteTotals(quote);
  recordAttempt("quote", quoteId);
  const at = new Date().toISOString();

  let emailOutcome: DeliveryOutcome | undefined;
  if (emailTo) {
    const result = await sendQuoteEmail({
      to: emailTo,
      quoteId,
      quoteNumber: quote.number,
      title: version.title,
      customerName: customer.name,
      amount: t.toPay,
      validUntil: version.validUntil,
      token: quote.token,
      bankidEnabled: true,
    });
    emailOutcome = toOutcome(result, emailTo, QUOTE_SEND_FAILED);
    persistDelivery(quote, { channel: "EMAIL", kind: "send", destination: emailTo, outcome: emailOutcome, at });
  }

  let smsOutcome: DeliveryOutcome | undefined;
  if (smsTo) {
    const result = await sendSms({ to: smsTo, message: quoteSmsText(quote.token) });
    smsOutcome = smsToOutcome(result, smsTo);
    persistDelivery(quote, { channel: "SMS", kind: "send", destination: smsTo, outcome: smsOutcome, at });
  }

  const outcome = combineOutcomes(emailOutcome, smsOutcome);
  if (emailOutcome?.ok) {
    sendQuote(quoteId, {
      mode: emailOutcome.mode,
      ok: true,
      messageId: emailOutcome.messageId,
      sentTo: emailTo,
      channel: "EMAIL",
    });
    if (smsOutcome?.ok) {
      logActivity(`Offert #${quote.number} skickades med SMS till ${smsTo} (${kr(t.toPay)}).`, {
        customerId: customer.id,
        entity: { type: "offert", id: quoteId },
      });
    }
  } else if (smsOutcome?.ok) {
    sendQuote(quoteId, {
      mode: smsOutcome.mode,
      ok: true,
      messageId: smsOutcome.messageId,
      sentTo: smsTo,
      channel: "SMS",
    });
  } else {
    save();
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
  return deliverInvoiceWithChannels(invoiceId, { email: true, sms: false }, createdBy);
}

export async function deliverInvoiceWithChannels(
  invoiceId: string,
  channels?: SelectedChannels,
  createdBy: Actor = "anvandare"
): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`invoice:${invoiceId}`, () => deliverInvoiceWithChannelsOnce(invoiceId, channels, createdBy));
}

async function deliverInvoiceWithChannelsOnce(
  invoiceId: string,
  requested: SelectedChannels | undefined,
  createdBy: Actor
): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice) throw new Error("Fakturan finns inte");
  if (invoice.status === "utkast") throw new Error("Utkast kan inte skickas innan fakturan är utfärdad.");
  if (invoice.number == null || !invoice.ocr) {
    throw new Error("Fakturan kunde inte skickas – nummer och OCR saknas. Försök igen.");
  }
  const customer = requireCustomer(invoice.customerId);
  const channels = resolveChannels(requested, customer);
  if ("error" in channels) return { outcome: { mode: "live", ok: false, error: channels.error } };

  let emailTo: string | undefined;
  if (channels.email) {
    const to = requireRecipient(customer.email);
    if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
    emailTo = to;
  }

  let smsTo: string | undefined;
  if (channels.sms) {
    const parsed = recipientE164(customer.phone);
    if (!parsed.ok) return { outcome: { mode: "live", ok: false, error: parsed.error } };
    smsTo = parsed.to;
  }

  const t = invoiceTotals(invoice);
  recordAttempt("invoice", invoiceId);
  const at = new Date().toISOString();

  let emailOutcome: DeliveryOutcome | undefined;
  if (emailTo) {
    const result = await sendInvoiceEmail({
      to: emailTo,
      invoiceId,
      invoiceNumber: invoice.number,
      customerName: customer.name,
      amount: t.toPay,
      dueDate: invoice.dueDate,
      token: invoice.token,
      ocr: invoice.ocr,
    });
    emailOutcome = toOutcome(result, emailTo, INVOICE_SEND_FAILED);
    persistDelivery(invoice, { channel: "EMAIL", kind: "send", destination: emailTo, outcome: emailOutcome, at });
    if (!emailOutcome.ok) {
      logActivity(`Faktura #${invoice.number} kunde inte e-postas till ${customer.name}.`, {
        customerId: customer.id,
        entity: { type: "faktura", id: invoice.id },
        createdBy,
      });
    }
  }

  let smsOutcome: DeliveryOutcome | undefined;
  if (smsTo) {
    const result = await sendSms({ to: smsTo, message: invoiceSmsText(invoice.token) });
    smsOutcome = smsToOutcome(result, smsTo);
    persistDelivery(invoice, { channel: "SMS", kind: "send", destination: smsTo, outcome: smsOutcome, at });
  }

  const outcome = combineOutcomes(emailOutcome, smsOutcome);
  if (emailOutcome?.ok) {
    deliverInvoice(invoiceId, createdBy, {
      mode: emailOutcome.mode,
      ok: true,
      messageId: emailOutcome.messageId,
      sentTo: emailTo,
      channel: "EMAIL",
    });
    if (smsOutcome?.ok) {
      logActivity(`Faktura #${invoice.number} skickades med SMS till ${smsTo}.`, {
        customerId: customer.id,
        entity: { type: "faktura", id: invoice.id },
        createdBy,
      });
    }
  } else if (smsOutcome?.ok) {
    deliverInvoice(invoiceId, createdBy, {
      mode: smsOutcome.mode,
      ok: true,
      messageId: smsOutcome.messageId,
      sentTo: smsTo,
      channel: "SMS",
    });
  } else {
    save();
  }
  return { outcome };
}

/** E-posta betalningspåminnelse för en försenad faktura. */
export async function remindInvoiceByEmail(invoiceId: string, by: Actor = "anvandare"): Promise<{ outcome: DeliveryOutcome }> {
  return remindInvoiceWithChannels(invoiceId, { email: true, sms: false }, by);
}

export async function remindInvoiceWithChannels(
  invoiceId: string,
  channels?: SelectedChannels,
  by: Actor = "anvandare"
): Promise<{ outcome: DeliveryOutcome }> {
  return withDocumentLock(`invoice-reminder:${invoiceId}`, () => remindInvoiceWithChannelsOnce(invoiceId, channels, by));
}

async function remindInvoiceWithChannelsOnce(
  invoiceId: string,
  requested: SelectedChannels | undefined,
  by: Actor
): Promise<{ outcome: DeliveryOutcome }> {
  const invoice = getInvoice(invoiceId);
  if (!invoice || !(invoice.status === "skickad" || invoice.status === "delbetald") || invoice.type === "kredit") {
    return { outcome: { mode: "live", ok: false, error: "Fakturan kan inte påminnas." } };
  }
  if (!invoice.sentAt || invoice.number == null) {
    return { outcome: { mode: "live", ok: false, error: "Fakturan måste ha skickats innan en påminnelse kan gå ut." } };
  }
  const customer = requireCustomer(invoice.customerId);
  const channels = resolveChannels(requested, customer);
  if ("error" in channels) return { outcome: { mode: "live", ok: false, error: channels.error } };

  let emailTo: string | undefined;
  if (channels.email) {
    const to = requireRecipient(customer.email);
    if (typeof to !== "string") return { outcome: { mode: "live", ok: false, error: to.error } };
    emailTo = to;
  }

  let smsTo: string | undefined;
  if (channels.sms) {
    const parsed = recipientE164(customer.phone);
    if (!parsed.ok) return { outcome: { mode: "live", ok: false, error: parsed.error } };
    smsTo = parsed.to;
  }

  const due = invoiceOutstanding(invoice);
  const t = invoiceTotals(invoice);
  recordAttempt("invoice", invoiceId);
  const at = new Date().toISOString();

  let emailOutcome: DeliveryOutcome | undefined;
  if (emailTo) {
    const result = await sendPaymentReminder({
      to: emailTo,
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
    emailOutcome = toOutcome(result, emailTo, REMINDER_SEND_FAILED);
    persistDelivery(invoice, { channel: "EMAIL", kind: "reminder", destination: emailTo, outcome: emailOutcome, at });
  }

  let smsOutcome: DeliveryOutcome | undefined;
  if (smsTo) {
    const result = await sendSms({ to: smsTo, message: invoiceReminderSmsText(invoice.token, invoice.number) });
    smsOutcome = smsToOutcome(result, smsTo);
    persistDelivery(invoice, { channel: "SMS", kind: "reminder", destination: smsTo, outcome: smsOutcome, at });
  }

  const outcome = combineOutcomes(emailOutcome, smsOutcome);
  if (emailOutcome?.ok) {
    sendReminder(invoiceId, by, {
      mode: emailOutcome.mode,
      ok: true,
      messageId: emailOutcome.messageId,
      sentTo: emailTo,
      channel: "EMAIL",
    });
    if (smsOutcome?.ok) {
      const who = by === "assistent" ? "Assistenten" : "Du";
      logActivity(`${who} skickade en betalningspåminnelse med SMS för faktura #${invoice.number} till ${smsTo}.`, {
        customerId: customer.id,
        entity: { type: "faktura", id: invoice.id },
        createdBy: by,
      });
    }
  } else if (smsOutcome?.ok) {
    sendReminder(invoiceId, by, {
      mode: smsOutcome.mode,
      ok: true,
      messageId: smsOutcome.messageId,
      sentTo: smsTo,
      channel: "SMS",
    });
  } else {
    save();
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
