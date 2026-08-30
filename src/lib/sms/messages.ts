import { absoluteAppUrl } from "../mail";
import { db } from "../store";

function businessName(): string {
  return db().settings.name?.trim() || "Driva";
}

export function quoteSmsText(token: string): string {
  return `${businessName()} har skickat en offert till dig. Visa offerten: ${absoluteAppUrl(`/offert/${token}`)}`;
}

export function invoiceSmsText(token: string): string {
  return `${businessName()} har skickat en faktura till dig. Visa fakturan: ${absoluteAppUrl(`/faktura/${token}`)}`;
}

export function invoiceReminderSmsText(token: string, invoiceNumber: number): string {
  return `${businessName()} påminner om faktura #${invoiceNumber}. Visa fakturan: ${absoluteAppUrl(`/faktura/${token}`)}`;
}
