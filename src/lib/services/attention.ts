import { db } from "../store";
import type { Customer, CustomerRequest, Expense, Invoice, Job, Quote } from "../types";
import { currentVersion, daysOverdue, invoiceTotals, isOverdue, jobQuote, quoteTotals, quoteWaitingDays, requireCustomer } from "./data";
import { docTotals } from "../calc";

export type AttentionItem =
  | { kind: "forfragan"; id: string; request: CustomerRequest; customer: Customer }
  | { kind: "offert_uppfoljning"; id: string; quote: Quote; customer: Customer; days: number; toPay: number }
  | { kind: "forsenad_faktura"; id: string; invoice: Invoice; customer: Customer; days: number; toPay: number }
  | { kind: "kvitto_saknas"; id: string; expense: Expense }
  | { kind: "bokforingsfraga"; id: string; expense: Expense }
  | { kind: "fakturera_jobb"; id: string; job: Job; customer: Customer; amount: number };

/** Allt som behöver användarens uppmärksamhet, viktigast först. */
export function attentionItems(): AttentionItem[] {
  const data = db();
  const items: AttentionItem[] = [];

  // Försenade fakturor.
  for (const inv of data.invoices.filter(isOverdue)) {
    items.push({
      kind: "forsenad_faktura",
      id: `late-${inv.id}`,
      invoice: inv,
      customer: requireCustomer(inv.customerId),
      days: daysOverdue(inv),
      toPay: invoiceTotals(inv).toPay,
    });
  }

  // Nya förfrågningar.
  for (const r of data.requests.filter((r) => r.status === "ny")) {
    items.push({ kind: "forfragan", id: `req-${r.id}`, request: r, customer: requireCustomer(r.customerId) });
  }

  // Offerter som väntat på BankID i mer än 7 dagar.
  for (const q of data.quotes.filter((q) => q.status === "skickad")) {
    const days = quoteWaitingDays(q);
    if (days >= 7) {
      items.push({
        kind: "offert_uppfoljning",
        id: `quote-${q.id}`,
        quote: q,
        customer: requireCustomer(q.customerId),
        days,
        toPay: quoteTotals(q).toPay,
      });
    }
  }

  // Klara jobb som inte slutfakturerats.
  for (const job of data.jobs.filter((j) => j.status === "klart")) {
    const remaining = remainingToInvoiceForJob(job.id);
    if (remaining > 0) {
      items.push({
        kind: "fakturera_jobb",
        id: `bill-${job.id}`,
        job,
        customer: requireCustomer(job.customerId),
        amount: remaining,
      });
    }
  }

  // Köp som saknar kvitto.
  for (const e of data.expenses.filter((e) => e.status === "saknar_kvitto")) {
    items.push({ kind: "kvitto_saknas", id: `receipt-${e.id}`, expense: e });
  }

  // Bokföringsfrågor (låg säkerhet).
  for (const e of data.expenses.filter((e) => e.status === "behover_svar")) {
    items.push({ kind: "bokforingsfraga", id: `question-${e.id}`, expense: e });
  }

  return items;
}

/** Hur mycket som återstår att fakturera för ett uppdrag (utifrån godkänd offert). */
export function remainingToInvoiceForJob(jobId: string): number {
  const data = db();
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return 0;
  const quote = jobQuote(job);
  if (!quote || quote.status !== "godkand") return 0;
  const version = currentVersion(quote);
  const total = docTotals(version.lines, version.rot).total;
  const invoiced = data.invoices
    .filter((i) => i.jobId === jobId && i.status !== "krediterad")
    .reduce((s, i) => s + invoiceTotals(i).total, 0);
  return Math.max(0, total - invoiced);
}

/** Offertbelopp, fakturerat, kvar och betalt för ett uppdrag. */
export function jobMoneySummary(jobId: string) {
  const data = db();
  const job = data.jobs.find((j) => j.id === jobId);
  const quote = job ? jobQuote(job) : undefined;
  const quoteAmount = quote ? quoteTotals(quote).toPay : 0;
  const invoices = data.invoices.filter((i) => i.jobId === jobId && i.status !== "krediterad");
  const invoiced = invoices.reduce((s, i) => s + invoiceTotals(i).total, 0);
  const paid = invoices.filter((i) => i.status === "betald").reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  return { quote, quoteAmount, invoiced, remaining: remainingToInvoiceForJob(jobId), paid, invoices };
}

/** Nästa obetalda del i den godkända offertens betalningsplan, om det finns en. */
export function nextPaymentPlanPartForJob(jobId: string): {
  index: number;
  percent: number;
  label: string;
  amount: number;
  isLast: boolean;
} | null {
  const data = db();
  const job = data.jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const quote = jobQuote(job);
  if (!quote || quote.status !== "godkand") return null;
  const version = currentVersion(quote);
  const plan = version.paymentPlan;
  if (plan.length === 0) return null;
  const issued = data.invoices.filter(
    (i) => (i.quoteId === quote.id || i.jobId === jobId) && i.status !== "krediterad" && i.type !== "kredit"
  );
  const index = issued.length;
  if (index >= plan.length) return null;
  const part = plan[index];
  const remaining = remainingToInvoiceForJob(jobId);
  if (remaining <= 0) return null;
  const isLast = index === plan.length - 1;
  const fromPlan = Math.round((docTotals(version.lines, version.rot).total * part.percent) / 100);
  return { index, percent: part.percent, label: part.label, amount: isLast ? remaining : fromPlan, isLast };
}

/** Uppdrag som pågår eller startar inom en vecka, sorterade på startdatum. */
export function jobsThisWeek() {
  return db()
    .jobs.filter((j) => {
      if (j.status === "pagar") return true;
      if (j.status === "kommande" && j.startDate) {
        const days = (new Date(j.startDate).getTime() - Date.now()) / 86_400_000;
        return days <= 7;
      }
      return false;
    })
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
}

/** Sammanfattning till Hem-sidans "Du har"-rad. */
export function homeSummary() {
  const data = db();
  const newRequests = data.requests.filter((r) => r.status === "ny").length;
  const waitingQuotes = data.quotes.filter((q) => q.status === "skickad").length;
  const unpaid = data.invoices.filter((i) => i.status === "skickad");
  const unpaidSum = unpaid.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  const overdueCount = unpaid.filter(isOverdue).length;
  const missingReceipts = data.expenses.filter((e) => e.status === "saknar_kvitto").length;
  return { newRequests, waitingQuotes, jobsThisWeek: jobsThisWeek().length, unpaidSum, overdueCount, missingReceipts };
}
