import { db } from "../store";
import { jobQuote } from "./data";
import { derivedJobStatus } from "./job-lifecycle";
import { jobMoney, type JobMoney } from "./job-economy";
import { nextPaymentPlanPartForQuote } from "./business-chain";

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
  return nextPaymentPlanPartForQuote(quote.id);
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
