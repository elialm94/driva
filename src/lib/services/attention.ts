import { db } from "../store";
import { currentVersion, jobQuote } from "./data";
import { docTotals } from "../calc";
import { derivedJobStatus } from "./job-lifecycle";
import { invoicesForJobOrQuote, jobMoney, type JobMoney } from "./job-economy";

/**
 * Pengahjälpare för uppdrag: vad är offererat, fakturerat, kvar och betalt.
 * Beräkningen bor i job-economy.ts (delas med uppdragslistan – EN sanning).
 * "Vad behöver jag göra?"-listan ligger i ./actions (getBusinessActions).
 */

/** Hur mycket som återstår att fakturera för ett uppdrag (utifrån godkänd offert). */
export function remainingToInvoiceForJob(jobId: string): number {
  return jobMoney(jobId).remaining;
}

/** Offertbelopp, fakturerat, kvar och betalt för ett uppdrag. */
export function jobMoneySummary(jobId: string): JobMoney {
  return jobMoney(jobId);
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
  const issued = invoicesForJobOrQuote(jobId, quote.id).filter(
    (i) => i.status !== "krediterad" && i.type !== "kredit"
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
      if (j.archivedAt) return false;
      const lifecycle = derivedJobStatus(j, now);
      if (lifecycle === "klart") return false;
      if (lifecycle === "pagar") return true;
      if (!j.startDate) return false;
      const days = (new Date(j.startDate).getTime() - now.getTime()) / 86_400_000;
      return days >= 0 && days <= 7;
    })
    .sort((a, b) => (a.startDate ?? "").localeCompare(b.startDate ?? ""));
}
