import { datumKort, kr } from "../format";
import type { Job } from "../types";

/** Det användaren ser. Pågår räknas fram från datum – det är inte ett klick. */
export type DerivedJobStatus = "planerat" | "pagar" | "klart";

export type JobEconomyKind = "kvar" | "vantar" | "betalt" | "tom";

export type PaymentPlanPartKind = "before_start" | "at_start" | "on_done";

function localDateKey(value: Date | string): string {
  const d = typeof value === "string" ? new Date(value) : value;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function derivedJobStatus(
  job: Pick<Job, "status" | "startDate" | "completedAt">,
  now = new Date()
): DerivedJobStatus {
  if (job.completedAt || job.status === "klart") return "klart";
  if (job.startDate && localDateKey(job.startDate) <= localDateKey(now)) return "pagar";
  if (!job.startDate && job.status === "pagar") return "pagar";
  return "planerat";
}

export function paymentPlanPartKind(label: string, isLast: boolean): PaymentPlanPartKind {
  const l = label.toLowerCase();
  if (/före|förskott|forskott|deposition/.test(l)) return "before_start";
  if (/klart|slut|godkänt|godkänd|färdig/.test(l)) return "on_done";
  if (/start/.test(l)) return "at_start";
  return isLast ? "on_done" : "at_start";
}

export function isPaymentPlanPartDue(
  part: { label: string; isLast: boolean },
  derived: DerivedJobStatus
): boolean {
  const kind = paymentPlanPartKind(part.label, part.isLast);
  if (kind === "on_done") return derived === "klart";
  if (kind === "before_start") return true;
  return derived === "pagar" || derived === "klart";
}

export function jobWhenLabel(job: Pick<Job, "startDate" | "endDate" | "completedAt" | "status">): string {
  const derived = derivedJobStatus(job);
  if (derived === "klart") {
    return job.completedAt ? `Klart ${datumKort(job.completedAt)}` : "Klart";
  }
  if (job.startDate && job.endDate) {
    const start = new Date(job.startDate);
    const end = new Date(job.endDate);
    const day = new Intl.DateTimeFormat("sv-SE", { day: "numeric" });
    const month = new Intl.DateTimeFormat("sv-SE", { month: "short" });
    const monthLabel = (d: Date) => month.format(d).replace(".", "").trim();
    if (start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth()) {
      return `${day.format(start)}–${day.format(end)} ${monthLabel(end)}`;
    }
    return `${datumKort(job.startDate)} – ${datumKort(job.endDate)}`;
  }
  if (job.startDate) return datumKort(job.startDate);
  return "Datum saknas";
}

export function jobEconomyLine(input: { remaining: number; unpaid: number; paid: number }): {
  label: string;
  kind: JobEconomyKind;
} {
  if (input.remaining > 0) return { label: `${kr(input.remaining)} kvar`, kind: "kvar" };
  if (input.unpaid > 0) return { label: `${kr(input.unpaid)} väntar på betalning`, kind: "vantar" };
  if (input.paid > 0) return { label: "Betalt ✓", kind: "betalt" };
  return { label: "—", kind: "tom" };
}

export function compareJobsDefault(
  a: { lifecycle: DerivedJobStatus; startDate?: string; completedAt?: string },
  b: { lifecycle: DerivedJobStatus; startDate?: string; completedAt?: string }
): number {
  const rank = (s: DerivedJobStatus) => (s === "pagar" ? 0 : s === "planerat" ? 1 : 2);
  const byLife = rank(a.lifecycle) - rank(b.lifecycle);
  if (byLife !== 0) return byLife;
  if (a.lifecycle === "klart") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  return (a.startDate ?? "9").localeCompare(b.startDate ?? "9");
}
