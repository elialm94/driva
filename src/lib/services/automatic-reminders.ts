import { db } from "../store";
import { todayDate } from "../accounting/dates";
import { currentVersion, isOverdue } from "./data";
import { followUpQuoteByEmail, remindInvoiceByEmail } from "./document-mail";

/**
 * Automatiska påminnelser: offerter som väntat 7 dagar utan svar, och
 * förfallna fakturor som inte påmints på 7 dagar. Anropas av cron – samma
 * mejl som knappen på dokumentet, så kunden får aldrig två olika texter.
 */

export const AUTO_QUOTE_FOLLOW_UP_DAYS = 7;
export const AUTO_INVOICE_REMINDER_DAYS = 7;
export const AUTO_INVOICE_MAX_REMINDERS = 2;

function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
}

export function quotesDueForFollowUp(today: string = todayDate()): string[] {
  const ids: string[] = [];
  for (const q of db().quotes) {
    if (q.status !== "skickad" || !q.sentAt) continue;
    const version = currentVersion(q);
    if (version.validUntil < today) continue;
    if (q.followUps.length > 0) continue;
    if (daysBetween(q.sentAt, today) < AUTO_QUOTE_FOLLOW_UP_DAYS) continue;
    ids.push(q.id);
  }
  return ids;
}

export function invoicesDueForReminder(today: string = todayDate()): string[] {
  const ids: string[] = [];
  for (const inv of db().invoices) {
    if (inv.type === "kredit") continue;
    if (inv.status !== "skickad" && inv.status !== "delbetald") continue;
    if (!isOverdue(inv)) continue;
    if ((inv.reminders?.length ?? 0) >= AUTO_INVOICE_MAX_REMINDERS) continue;
    const last = inv.reminders?.[inv.reminders.length - 1];
    const since = last ?? inv.dueDate;
    if (daysBetween(since, today) < AUTO_INVOICE_REMINDER_DAYS) continue;
    ids.push(inv.id);
  }
  return ids;
}

export async function runAutomaticReminders(today: string = todayDate()): Promise<{
  quotes: number;
  invoices: number;
  errors: string[];
}> {
  const errors: string[] = [];
  let quotes = 0;
  let invoices = 0;
  for (const id of quotesDueForFollowUp(today)) {
    const { outcome } = await followUpQuoteByEmail(id, "assistent");
    if (outcome.ok) quotes += 1;
    else if (outcome.error) errors.push(outcome.error);
  }
  for (const id of invoicesDueForReminder(today)) {
    const { outcome } = await remindInvoiceByEmail(id, "assistent");
    if (outcome.ok) invoices += 1;
    else if (outcome.error) errors.push(outcome.error);
  }
  return { quotes, invoices, errors };
}
