/**
 * Centralt e-postlager. React/routes anropar inte Resend.
 * sendQuote / sendInvoice / sendPaymentReminder / sendCollaborationInvite
 * skickar bara – persistens sker efter provider-succé i document-mail / collaboration.
 */

import { db } from "../store";
import {
  MAIL_NOT_CONFIGURED,
  absoluteAppUrl,
  mailFromAddress,
  sendMail,
  type MailMessage,
  type MailResult,
  type MailSendMeta,
} from "../mail";
import { isEmailFormat } from "../settings-validation";
import { tenantContext } from "../storage/context";
import {
  collaborationInviteEmail,
  invoiceEmail,
  invoiceReminderEmail,
  quoteEmail,
  quoteFollowUpEmail,
} from "./templates";

export const QUOTE_SEND_FAILED =
  "E-posttjänsten kunde inte ta emot offerten just nu. Kontrollera avsändaren och försök igen.";
export const INVOICE_SEND_FAILED = "Fakturan kunde inte skickas. Försök igen.";
export const REMINDER_SEND_FAILED = "Påminnelsen kunde inte skickas. Försök igen.";

const inFlight = new Map<string, Promise<MailResult>>();

export function userFacingSendError(
  result: Extract<MailResult, { ok: false }>,
  fallback: string
): string {
  if (result.code === "not_configured") return result.error || MAIL_NOT_CONFIGURED;
  if (result.code === "unverified_domain") return result.error;
  return fallback;
}

function footer(): string {
  const s = db().settings;
  return [s.name, s.phone, s.email].filter(Boolean).join(" · ");
}

function businessId(): string | undefined {
  return tenantContext()?.businessId;
}

function replyToAddress(): string | undefined {
  const email = db().settings.email?.trim();
  return email && isEmailFormat(email) ? email : undefined;
}

function envelope(to: string, built: { subject: string; text: string; html: string }): MailMessage {
  return {
    to,
    from: mailFromAddress(),
    replyTo: replyToAddress(),
    subject: built.subject,
    text: built.text,
    html: built.html,
  };
}

async function sendOnce(lockKey: string, send: () => Promise<MailResult>): Promise<MailResult> {
  const existing = inFlight.get(lockKey);
  if (existing) return existing;
  const pending = send().finally(() => {
    inFlight.delete(lockKey);
  });
  inFlight.set(lockKey, pending);
  return pending;
}

export async function sendQuote(input: {
  to: string;
  quoteId: string;
  quoteNumber: number;
  title: string;
  customerName: string;
  amount: number;
  validUntil: string;
  token: string;
  bankidEnabled: boolean;
}): Promise<MailResult> {
  const built = quoteEmail({
    businessName: db().settings.name,
    customerName: input.customerName,
    quoteNumber: input.quoteNumber,
    title: input.title,
    amount: input.amount,
    validUntil: input.validUntil,
    url: absoluteAppUrl(`/offert/${input.token}`),
    bankidEnabled: input.bankidEnabled,
    footer: footer(),
  });
  const meta: MailSendMeta = { kind: "quote", documentId: input.quoteId, businessId: businessId() };
  return sendOnce(`quote:${input.quoteId}`, () => sendMail(envelope(input.to, built), meta));
}

export async function sendInvoice(input: {
  to: string;
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  amount: number;
  dueDate: string;
  token: string;
  ocr?: string;
}): Promise<MailResult> {
  const s = db().settings;
  const built = invoiceEmail({
    businessName: s.name,
    customerName: input.customerName,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    dueDate: input.dueDate,
    ocr: input.ocr,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    url: absoluteAppUrl(`/faktura/${input.token}`),
    footer: footer(),
  });
  const meta: MailSendMeta = { kind: "invoice", documentId: input.invoiceId, businessId: businessId() };
  return sendOnce(`invoice:${input.invoiceId}`, () => sendMail(envelope(input.to, built), meta));
}

export async function sendPaymentReminder(input: {
  to: string;
  invoiceId: string;
  invoiceNumber: number;
  customerName: string;
  amount: number;
  outstanding: number;
  dueDate: string;
  token: string;
  ocr?: string;
  partial?: boolean;
}): Promise<MailResult> {
  const s = db().settings;
  const built = invoiceReminderEmail({
    businessName: s.name,
    customerName: input.customerName,
    invoiceNumber: input.invoiceNumber,
    amount: input.amount,
    outstanding: input.outstanding,
    dueDate: input.dueDate,
    ocr: input.ocr,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    url: absoluteAppUrl(`/faktura/${input.token}`),
    footer: footer(),
    partial: input.partial,
  });
  const meta: MailSendMeta = { kind: "invoice_reminder", documentId: input.invoiceId, businessId: businessId() };
  return sendOnce(`invoice-reminder:${input.invoiceId}`, () => sendMail(envelope(input.to, built), meta));
}

export async function sendQuoteFollowUp(input: {
  to: string;
  quoteId: string;
  quoteNumber: number;
  title: string;
  customerName: string;
  validUntil: string;
  token: string;
}): Promise<MailResult> {
  const built = quoteFollowUpEmail({
    businessName: db().settings.name,
    customerName: input.customerName,
    quoteNumber: input.quoteNumber,
    title: input.title,
    validUntil: input.validUntil,
    url: absoluteAppUrl(`/offert/${input.token}`),
    footer: footer(),
  });
  const meta: MailSendMeta = { kind: "quote_followup", documentId: input.quoteId, businessId: businessId() };
  return sendOnce(`quote-followup:${input.quoteId}`, () => sendMail(envelope(input.to, built), meta));
}

export async function sendCollaborationInvite(input: {
  to: string;
  invitationId: string;
  invitedByName: string;
  companyName: string;
  roleLabel: string;
  url: string;
  expiresDays: number;
}): Promise<MailResult> {
  const built = collaborationInviteEmail({
    invitedByName: input.invitedByName,
    companyName: input.companyName,
    roleLabel: input.roleLabel,
    url: input.url,
    expiresDays: input.expiresDays,
  });
  const meta: MailSendMeta = { kind: "collaboration_invite", documentId: input.invitationId, businessId: businessId() };
  return sendOnce(`invite:${input.invitationId}`, () => sendMail(envelope(input.to, built), meta));
}
