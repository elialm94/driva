import { db, save } from "../store";
import { uid } from "../ids";
import type { Accrual, AccrualKind, Expense, SupplierInvoice } from "../types";
import { getFiscalYear, todayDate } from "./fiscal";
import { postVerification } from "./engine";
import { logAudit } from "./audit";
import { categoryByKey } from "../bas";

/**
 * Periodiseringar: kostnader/intäkter som hör till en annan period flyttas
 * över bokslutet. Användaren anger bara VAD underlaget gäller och VILKEN
 * period ("Adobe-fakturan gäller sep 2026–aug 2027") – motorn räknar ut
 * fördelningen deterministiskt (hela månader) och bokför utan att användaren
 * någonsin ser debet/kredit.
 */

const BALANCE_ACCOUNTS: Record<AccrualKind, number> = {
  forutbetald_kostnad: 1710,
  upplupen_kostnad: 2990,
  forutbetald_intakt: 2970,
  upplupen_intakt: 1790,
};

export const ACCRUAL_LABEL: Record<AccrualKind, string> = {
  forutbetald_kostnad: "Förutbetald kostnad",
  upplupen_kostnad: "Upplupen kostnad",
  forutbetald_intakt: "Förutbetald intäkt",
  upplupen_intakt: "Upplupen intäkt",
};

function monthKey(date: string): number {
  return Number(date.slice(0, 7).replace("-", ""));
}

function monthsBetween(from: string, to: string): number {
  const a = monthKey(from);
  const b = monthKey(to);
  return (Math.floor(b / 100) - Math.floor(a / 100)) * 12 + (b % 100) - (a % 100) + 1;
}

/**
 * Hur stor del av beloppet som hör till tiden EFTER räkenskapsårets slut
 * (för förutbetald kostnad/intäkt) – fördelat på hela månader.
 */
export function amountAfterYearEnd(total: number, fromDate: string, toDate: string, fyEndDate: string): number {
  const totalMonths = monthsBetween(fromDate, toDate);
  if (totalMonths <= 0) return 0;
  if (toDate <= fyEndDate) return 0;
  const monthsAfter = Math.min(totalMonths, monthsBetween(fyEndDate, toDate) - 1);
  if (monthsAfter <= 0) return 0;
  return Math.round((total * monthsAfter) / totalMonths);
}

export interface PlanAccrualInput {
  kind: AccrualKind;
  description: string;
  /** Totalbelopp exkl. moms för hela perioden. */
  totalAmount: number;
  /** Kostnads-/intäktskonto som justeras. */
  counterAccount: number;
  fromDate: string;
  toDate: string;
  fiscalYearId: string;
  sourceType?: Accrual["sourceType"];
  sourceId?: string;
  by: "anvandare" | "assistent";
}

/** Planera en periodisering (bokförs vid bokslutet, återförs automatiskt i nya året). */
export function planAccrual(input: PlanAccrualInput): Accrual {
  const fy = getFiscalYear(input.fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  const amount =
    input.kind === "forutbetald_kostnad" || input.kind === "forutbetald_intakt"
      ? amountAfterYearEnd(input.totalAmount, input.fromDate, input.toDate, fy.endDate)
      : input.totalAmount;
  if (amount <= 0) {
    throw new Error("Ingen del av beloppet hör till nästa räkenskapsår – ingen periodisering behövs.");
  }
  const accrual: Accrual = {
    id: uid(),
    kind: input.kind,
    description: input.description,
    amount,
    counterAccount: input.counterAccount,
    balanceAccount: BALANCE_ACCOUNTS[input.kind],
    fromDate: input.fromDate,
    toDate: input.toDate,
    fiscalYearId: fy.id,
    status: "planerad",
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    createdAt: new Date().toISOString(),
  };
  db().accruals.push(accrual);
  logAudit(input.by, "periodisering_planerad", `Periodisering planerades: ${input.description} (${amount} kr flyttas över bokslutet).`, {
    targetType: "periodisering",
    targetId: accrual.id,
  });
  save();
  return accrual;
}

/** Föreslå periodisering för en bokförd utgift/leverantörsfaktura utifrån angiven period. */
export function planAccrualForSource(
  source: { type: "utgift"; expense: Expense } | { type: "leverantorsfaktura"; invoice: SupplierInvoice },
  period: { fromDate: string; toDate: string },
  fiscalYearId: string,
  by: "anvandare" | "assistent"
): Accrual {
  const isExpense = source.type === "utgift";
  const doc = isExpense ? source.expense : source.invoice;
  const net = doc.amount - doc.vatAmount;
  const categoryKey = isExpense ? (source.expense.category ?? "ovrigt") : source.invoice.category;
  const account = categoryByKey(categoryKey).account;
  const name = isExpense
    ? `${source.expense.supplier} – ${source.expense.description ?? "köp"}`
    : `${source.invoice.supplier} ${source.invoice.invoiceNumber}`;
  return planAccrual({
    kind: "forutbetald_kostnad",
    description: name,
    totalAmount: net,
    counterAccount: account,
    fromDate: period.fromDate,
    toDate: period.toDate,
    fiscalYearId,
    sourceType: source.type,
    sourceId: isExpense ? source.expense.id : source.invoice.id,
    by,
  });
}

/** Bokför en planerad periodisering (bokslutsverifikation) + återföring i nya året. */
export function bookAccrual(accrualId: string, by: "anvandare" | "assistent" | "auto"): Accrual {
  const accrual = db().accruals.find((a) => a.id === accrualId);
  if (!accrual) throw new Error("Periodiseringen finns inte.");
  if (accrual.status !== "planerad") return accrual;
  const fy = getFiscalYear(accrual.fiscalYearId);
  if (!fy) throw new Error("Räkenskapsåret finns inte.");
  if (fy.status === "stangt") throw new Error("Räkenskapsåret är stängt.");

  const debitBalance = accrual.kind === "forutbetald_kostnad" || accrual.kind === "upplupen_intakt";
  const ver = postVerification(
    {
      date: fy.endDate,
      description: `Periodisering: ${accrual.description}`,
      entries: debitBalance
        ? [
            { account: accrual.balanceAccount, debit: accrual.amount },
            { account: accrual.counterAccount, credit: accrual.amount },
          ]
        : [
            { account: accrual.counterAccount, debit: accrual.amount },
            { account: accrual.balanceAccount, credit: accrual.amount },
          ],
      source: { type: "periodisering", id: accrual.id },
      createdBy: by,
      explanation: `${accrual.description} avser perioden ${accrual.fromDate} till ${accrual.toDate}. ${accrual.amount} kr hör till nästa räkenskapsår och flyttas därför över bokslutet – automatisk återföring bokförs i det nya året.`,
    },
    { bypassPeriodLock: true }
  );
  accrual.bookVerificationId = ver.id;
  accrual.status = "bokford";
  logAudit(by === "auto" ? "system" : by, "periodisering_bokford", `Periodiseringen ${accrual.description} bokfördes (${accrual.amount} kr).`, {
    targetType: "periodisering",
    targetId: accrual.id,
  });
  save();
  return accrual;
}

/** Återför bokförda periodiseringar i det nya året (körs när året stängs). */
export function reverseAccrualsInto(nextYearFirstDate: string, fiscalYearId: string, by: "auto" | "anvandare"): number {
  let count = 0;
  for (const accrual of db().accruals) {
    if (accrual.fiscalYearId !== fiscalYearId || accrual.status !== "bokford") continue;
    const debitBalance = accrual.kind === "forutbetald_kostnad" || accrual.kind === "upplupen_intakt";
    const ver = postVerification({
      date: nextYearFirstDate,
      description: `Återföring periodisering: ${accrual.description}`,
      entries: debitBalance
        ? [
            { account: accrual.counterAccount, debit: accrual.amount },
            { account: accrual.balanceAccount, credit: accrual.amount },
          ]
        : [
            { account: accrual.balanceAccount, debit: accrual.amount },
            { account: accrual.counterAccount, credit: accrual.amount },
          ],
      source: { type: "periodisering", id: accrual.id },
      createdBy: by,
      explanation: `Automatisk återföring av periodiseringen från bokslutet – kostnaden/intäkten hamnar nu i rätt år.`,
    });
    accrual.reverseVerificationId = ver.id;
    accrual.status = "aterford";
    count++;
  }
  if (count) save();
  return count;
}

/** Planerade periodiseringar för ett år (att hantera i bokslutet). */
export function pendingAccruals(fiscalYearId: string): Accrual[] {
  return db().accruals.filter((a) => a.fiscalYearId === fiscalYearId && a.status === "planerad");
}

/** Periodiseringar som redan ligger i böckerna för året. */
export function bookedAccruals(fiscalYearId: string): Accrual[] {
  return db().accruals.filter((a) => a.fiscalYearId === fiscalYearId && a.status !== "planerad");
}

/**
 * Upptäck köp som ser ut att avse en längre period (t.ex. årslicenser).
 * Bara ett förslag – användaren bestämmer.
 */
export function accrualSuggestions(fiscalYearId: string): { description: string; sourceType: "utgift" | "leverantorsfaktura"; sourceId: string; amount: number }[] {
  const data = db();
  const fy = getFiscalYear(fiscalYearId);
  if (!fy) return [];
  const existing = new Set(data.accruals.map((a) => a.sourceId));
  const out: { description: string; sourceType: "utgift" | "leverantorsfaktura"; sourceId: string; amount: number }[] = [];
  const yearlyPattern = /(års|årlig|year|annual|12 mån|helår)/i;
  for (const e of data.expenses) {
    if (e.status !== "bokford" || existing.has(e.id)) continue;
    if (yearlyPattern.test(e.description ?? "")) {
      out.push({ description: `${e.supplier} – ${e.description}`, sourceType: "utgift", sourceId: e.id, amount: e.amount - e.vatAmount });
    }
  }
  for (const s of data.supplierInvoices) {
    if (existing.has(s.id)) continue;
    if (yearlyPattern.test(s.description)) {
      out.push({ description: `${s.supplier} ${s.invoiceNumber} – ${s.description}`, sourceType: "leverantorsfaktura", sourceId: s.id, amount: s.amount - s.vatAmount });
    }
  }
  return out;
}

/** Idag-datum exporteras för UI-defaultvärden. */
export { todayDate };
