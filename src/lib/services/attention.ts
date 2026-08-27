import { db } from "../store";
import type {
  BankTransaction,
  Customer,
  CustomerRequest,
  Expense,
  Invoice,
  Job,
  Quote,
  SupplierInvoice,
} from "../types";
import {
  currentVersion,
  daysOverdue,
  invoiceTotals,
  isOverdue,
  jobQuote,
  quoteTotals,
  quoteWaitingDays,
  requireCustomer,
} from "./data";
import { docTotals } from "../calc";
import { derivedJobStatus } from "./job-lifecycle";
import { taxReductionCaseForJob } from "./tax-reduction";
import { dagarTill } from "../format";

export const HOME_ATTENTION_VISIBLE = 3;

/** Prioritet på Hem: försenad faktura > betalningsbeslut > bokföring > förfrågan > offert > kvitto. */
export const ATTENTION_PRIORITY: Record<AttentionItem["kind"], number> = {
  forsenad_faktura: 0,
  betalningsbeslut: 1,
  bokforingsfraga: 2,
  forfragan: 3,
  offert_uppfoljning: 4,
  kvitto_saknas: 5,
};

export type AttentionItem =
  | { kind: "forfragan"; id: string; request: CustomerRequest; customer: Customer }
  | { kind: "offert_uppfoljning"; id: string; quote: Quote; customer: Customer; days: number; toPay: number }
  | { kind: "forsenad_faktura"; id: string; invoice: Invoice; customer: Customer; days: number; toPay: number }
  | {
      kind: "betalningsbeslut";
      id: string;
      source: "inbetalning";
      tx: BankTransaction;
      amount: number;
    }
  | {
      kind: "betalningsbeslut";
      id: string;
      source: "leverantor";
      supplierInvoice: SupplierInvoice;
      amount: number;
    }
  | { kind: "kvitto_saknas"; id: string; expense: Expense }
  | { kind: "bokforingsfraga"; id: string; expense: Expense };

export type HomeNextStep =
  | {
      kind: "forsta_faktura";
      id: string;
      job: Job;
      customer: Customer;
      amount: number;
      percent: number;
      partLabel: string;
    }
  | { kind: "kan_fakturera"; id: string; job: Job; customer: Customer; amount: number }
  | {
      kind: "resterande";
      id: string;
      job: Job;
      customer: Customer;
      amount: number;
      isFinal: boolean;
    }
  | { kind: "rot_ansok"; id: string; job: Job; customer: Customer; label: string };

/** Allt som behöver användarens uppmärksamhet, viktigast först. */
export function attentionItems(): AttentionItem[] {
  const data = db();
  const items: AttentionItem[] = [];

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

  for (const tx of data.bankTransactions) {
    if (tx.amount <= 0 || tx.status !== "behover_atgard") continue;
    items.push({
      kind: "betalningsbeslut",
      id: `pay-${tx.id}`,
      source: "inbetalning",
      tx,
      amount: tx.amount,
    });
  }

  for (const s of data.supplierInvoices) {
    if (s.status !== "obetald" || dagarTill(s.dueDate) >= 0) continue;
    items.push({
      kind: "betalningsbeslut",
      id: `sup-${s.id}`,
      source: "leverantor",
      supplierInvoice: s,
      amount: s.amount,
    });
  }

  for (const e of data.expenses.filter((e) => e.status === "behover_svar")) {
    items.push({ kind: "bokforingsfraga", id: `question-${e.id}`, expense: e });
  }

  for (const r of data.requests.filter((r) => r.status === "ny")) {
    items.push({ kind: "forfragan", id: `req-${r.id}`, request: r, customer: requireCustomer(r.customerId) });
  }

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

  for (const e of data.expenses.filter((e) => e.status === "saknar_kvitto")) {
    items.push({ kind: "kvitto_saknas", id: `receipt-${e.id}`, expense: e });
  }

  return rankAttention(items);
}

export function rankAttention(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => {
    const byKind = ATTENTION_PRIORITY[a.kind] - ATTENTION_PRIORITY[b.kind];
    if (byKind !== 0) return byKind;
    return attentionTieBreak(a, b);
  });
}

function attentionTieBreak(a: AttentionItem, b: AttentionItem): number {
  if (a.kind === "forsenad_faktura" && b.kind === "forsenad_faktura") {
    return b.days - a.days || b.toPay - a.toPay;
  }
  if (a.kind === "betalningsbeslut" && b.kind === "betalningsbeslut") {
    return b.amount - a.amount;
  }
  if (a.kind === "bokforingsfraga" && b.kind === "bokforingsfraga") {
    return a.expense.date.localeCompare(b.expense.date);
  }
  if (a.kind === "forfragan" && b.kind === "forfragan") {
    return b.request.createdAt.localeCompare(a.request.createdAt);
  }
  if (a.kind === "offert_uppfoljning" && b.kind === "offert_uppfoljning") {
    return b.days - a.days;
  }
  if (a.kind === "kvitto_saknas" && b.kind === "kvitto_saknas") {
    return a.expense.date.localeCompare(b.expense.date);
  }
  return 0;
}

/**
 * Administrativa nästa steg från offerter/fakturor – inte pågående jobb.
 * Kräver inte att användaren markerar uppdrag som klart.
 */
export function homeNextSteps(): HomeNextStep[] {
  const data = db();
  const steps: HomeNextStep[] = [];

  for (const job of data.jobs) {
    const quote = jobQuote(job);
    if (!quote || quote.status !== "godkand") continue;

    const remaining = remainingToInvoiceForJob(job.id);
    const money = jobMoneySummary(job.id);
    const next = nextPaymentPlanPartForJob(job.id);

    if (remaining > 0) {
      if (money.invoiced <= 0) {
        if (next && !next.isLast) {
          steps.push({
            kind: "forsta_faktura",
            id: `first-${job.id}`,
            job,
            customer: requireCustomer(job.customerId),
            amount: next.amount,
            percent: next.percent,
            partLabel: next.label,
          });
        } else {
          steps.push({
            kind: "kan_fakturera",
            id: `bill-${job.id}`,
            job,
            customer: requireCustomer(job.customerId),
            amount: remaining,
          });
        }
      } else {
        steps.push({
          kind: "resterande",
          id: `rest-${job.id}`,
          job,
          customer: requireCustomer(job.customerId),
          amount: next && !next.isLast ? next.amount : remaining,
          isFinal: !next || next.isLast,
        });
      }
    }

    const tax = taxReductionCaseForJob(job);
    if (tax.phase === "ready") {
      steps.push({
        kind: "rot_ansok",
        id: `rot-${job.id}`,
        job,
        customer: requireCustomer(job.customerId),
        label: tax.nextStep ?? `${tax.label} redo att ansökas`,
      });
    }
  }

  return steps;
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

/** Uppdrag som pågår eller startar inom en vecka, utifrån planerade datum. */
export function jobsThisWeek(now = new Date()) {
  return db()
    .jobs.filter((j) => {
      const lifecycle = derivedJobStatus(j, now);
      if (lifecycle === "klart") return false;
      if (lifecycle === "pagar") return true;
      if (!j.startDate) return false;
      const days = (new Date(j.startDate).getTime() - now.getTime()) / 86_400_000;
      return days >= 0 && days <= 7;
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
