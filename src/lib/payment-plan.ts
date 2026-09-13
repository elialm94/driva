import type { PaymentPlanPart, PaymentPlanPartKind } from "./types";

/**
 * Betalplan – rena beräkningar (ingen db). Delas av offertformuläret,
 * offertdokumentet, delfaktureringen och avslutsflödet.
 *
 * Principer:
 *   * Sista delen är alltid RESTEN av avtalat belopp – aldrig procent rakt av.
 *     Då försvinner avrundningsfel och tidigare fakturor/krediter räknas in.
 *   * En del kan ha fast belopp (förskott i kronor) eller procent. Fast
 *     belopp styr när det finns.
 *   * "Utan betalplan" = en enda del på 100 % ("allt när arbetet är klart").
 */

export const DEFAULT_PAYMENT_PLAN: PaymentPlanPart[] = [
  { label: "Betalning när arbetet är klart", percent: 100 },
];

/** Har offerten en riktig betalplan (fler än en del)? */
export function hasPaymentPlan(plan: PaymentPlanPart[] | undefined): boolean {
  return Boolean(plan && plan.length > 1);
}

export function paymentPlanPartKind(plan: PaymentPlanPart[], index: number): PaymentPlanPartKind {
  const part = plan[index];
  if (part?.kind) return part.kind;
  if (plan.length <= 1) return "slutbetalning";
  if (index === plan.length - 1) return "slutbetalning";
  if (index === 0) return "forskott";
  return "delbetalning";
}

export const PAYMENT_PLAN_KIND_LABEL: Record<PaymentPlanPartKind, string> = {
  forskott: "Förskott",
  delbetalning: "Delbetalning",
  slutbetalning: "Slutbetalning",
};

/** Beloppet för en del (inkl. moms) räknat på avtalat belopp – utan hänsyn till rest. */
export function paymentPlanPartAmount(part: PaymentPlanPart, totalInclVat: number): number {
  if (part.amount != null && Number.isFinite(part.amount)) return Math.max(0, Math.round(part.amount));
  return Math.max(0, Math.round((totalInclVat * part.percent) / 100));
}

/**
 * Belopp per del så att summan alltid blir exakt totalInclVat: alla delar utom
 * den sista räknas var för sig, sista delen får resten (aldrig negativ).
 */
export function paymentPlanAmounts(plan: PaymentPlanPart[], totalInclVat: number): number[] {
  if (plan.length === 0) return [];
  const amounts = plan.map((p) => paymentPlanPartAmount(p, totalInclVat));
  const before = amounts.slice(0, -1).reduce((s, a) => s + a, 0);
  amounts[amounts.length - 1] = Math.max(0, Math.round(totalInclVat) - before);
  return amounts;
}

/** Procentandel som en del motsvarar (för visning när fast belopp används). */
export function paymentPlanPartPercent(part: PaymentPlanPart, totalInclVat: number): number {
  if (part.amount != null && totalInclVat > 0) return Math.round((part.amount / totalInclVat) * 1000) / 10;
  return part.percent;
}

/**
 * Valideringsfel för en betalplan, eller null. totalInclVat behövs för att
 * kontrollera fasta belopp; saknas det kontrolleras bara procenten.
 */
export function paymentPlanIssue(plan: PaymentPlanPart[], totalInclVat?: number): string | null {
  if (plan.length === 0) return "Betalplanen behöver minst en del.";
  for (const part of plan) {
    if (!part.label.trim()) return "Varje del i betalplanen behöver ett namn.";
    if (part.amount != null) {
      if (!Number.isFinite(part.amount) || part.amount < 0) return "Fast belopp måste vara 0 kr eller mer.";
    } else if (!Number.isFinite(part.percent) || part.percent < 0 || part.percent > 100) {
      return "Andelen måste vara mellan 0 och 100 %.";
    }
  }
  const fixed = plan.filter((p) => p.amount != null);
  if (fixed.length === 0) {
    const total = plan.reduce((s, p) => s + p.percent, 0);
    if (Math.abs(total - 100) > 0.001) return `Delarna måste summera till 100 % (nu ${total} %).`;
    return null;
  }
  if (plan[plan.length - 1].amount != null && plan.length > 1) {
    return "Sista delen är alltid resten av beloppet – ange den i procent.";
  }
  if (totalInclVat != null && totalInclVat > 0) {
    const fixedSum = fixed.reduce((s, p) => s + (p.amount ?? 0), 0);
    if (fixedSum > totalInclVat) return "Fasta belopp får inte överstiga offertens totalbelopp.";
    // Sista delen är resten och räknas inte – de övriga får inte redan fylla offerten.
    const percentBeforeLast = plan
      .slice(0, -1)
      .filter((p) => p.amount == null)
      .reduce((s, p) => s + p.percent, 0);
    const fixedPercent = (fixedSum / totalInclVat) * 100;
    if (percentBeforeLast + fixedPercent > 100.5) return "Delarna blir mer än 100 % av offerten.";
  }
  return null;
}

/** Är planen giltig nog att sparas/skickas? */
export function isPaymentPlanValid(plan: PaymentPlanPart[], totalInclVat?: number): boolean {
  return paymentPlanIssue(plan, totalInclVat) == null;
}

/** Sanera inkommande plan från formulär/AI: trimma, ta bort tomma fält, tvinga tal. */
export function normalizePaymentPlan(raw: unknown): PaymentPlanPart[] {
  if (!Array.isArray(raw)) return DEFAULT_PAYMENT_PLAN.map((p) => ({ ...p }));
  const out: PaymentPlanPart[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as Record<string, unknown>;
    const label = typeof r.label === "string" ? r.label.trim().slice(0, 120) : "";
    const percent = Number(r.percent);
    const part: PaymentPlanPart = { label, percent: Number.isFinite(percent) ? percent : 0 };
    if (r.amount != null && r.amount !== "") {
      const amount = Number(r.amount);
      if (Number.isFinite(amount) && amount >= 0) part.amount = Math.round(amount);
    }
    if (r.kind === "forskott" || r.kind === "delbetalning" || r.kind === "slutbetalning") part.kind = r.kind;
    out.push(part);
  }
  return out.length > 0 ? out : DEFAULT_PAYMENT_PLAN.map((p) => ({ ...p }));
}
