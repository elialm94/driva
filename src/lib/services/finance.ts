import { db } from "../store";
import { isCostAccount, isRevenueAccount } from "../bas";
import { invoiceTotals, isOverdue } from "./data";

/** Innevarande momsperiod (kvartal) med deklarations- och betaldatum. */
export function momsPeriod() {
  const now = new Date();
  const q = Math.floor(now.getMonth() / 3); // 0..3
  const start = new Date(now.getFullYear(), q * 3, 1);
  const end = new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59);
  // Kvartalsmoms deklareras och betalas den 12:e i andra månaden efter periodens slut.
  const due = new Date(now.getFullYear(), q * 3 + 4, 12);
  const namn = `${["januari–mars", "april–juni", "juli–september", "oktober–december"][q]} ${now.getFullYear()}`;
  return { start: start.toISOString(), end: end.toISOString(), due: due.toISOString(), namn };
}

/** Momsberäkning från verifikationerna – samma siffror som bokföringen. */
export function momsForCurrentPeriod() {
  const { start, end, due, namn } = momsPeriod();
  let utgaende = 0;
  let ingaende = 0;
  for (const v of db().verifications) {
    if (v.date < start || v.date > end) continue;
    for (const e of v.entries) {
      if (e.account === 2611) utgaende += e.credit - e.debit;
      if (e.account === 2641) ingaende += e.debit - e.credit;
    }
  }
  return { utgaende, ingaende, attBetala: utgaende - ingaende, due, namn };
}

export interface FinanceOverview {
  bank: number;
  moms: number;
  momsDue: string;
  fSkatt: number;
  payrollReserve: number;
  reserved: number;
  upcoming: number;
  upcomingRows: { label: string; amount: number; due: string }[];
  available: number;
}

/** Den enkla ekonomiska överblicken: banken, reserverat, kommande, ungefär tillgängligt. */
export function financeOverview(): FinanceOverview {
  const data = db();
  const bank = data.bankAccounts.reduce((s, a) => s + a.balance, 0);
  const moms = Math.max(0, momsForCurrentPeriod().attBetala);
  const momsDue = momsForCurrentPeriod().due;
  // Reserv: kommande två månaders F-skatt + en månads arbetsgivaravgifter/personalskatt.
  const fSkatt = data.settings.fSkattPerMonth * 2;
  const payrollReserve = data.settings.payrollReservePerMonth;
  const reserved = moms + fSkatt + payrollReserve;
  const upcomingRows = data.supplierInvoices
    .filter((s) => s.status === "obetald")
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .map((s) => ({ label: s.supplier, amount: s.amount, due: s.dueDate }));
  const upcoming = upcomingRows.reduce((s, r) => s + r.amount, 0);
  return {
    bank,
    moms,
    momsDue,
    fSkatt,
    payrollReserve,
    reserved,
    upcoming,
    upcomingRows,
    available: bank - reserved - upcoming,
  };
}

/** Nyckeltal för Pengar-sidan och assistenten. */
export function businessStats() {
  const data = db();
  const year = new Date().getFullYear();
  const monthKey = new Date().toISOString().slice(0, 7);

  let revenueYear = 0;
  let revenueMonth = 0;
  let costsYear = 0;
  for (const v of data.verifications) {
    const inYear = new Date(v.date).getFullYear() === year;
    const inMonth = v.date.slice(0, 7) === monthKey;
    for (const e of v.entries) {
      if (isRevenueAccount(e.account)) {
        const net = e.credit - e.debit;
        if (inYear) revenueYear += net;
        if (inMonth) revenueMonth += net;
      }
      if (isCostAccount(e.account) && inYear) {
        costsYear += e.debit - e.credit;
      }
    }
  }

  const unpaidInvoices = data.invoices.filter((i) => i.status === "skickad");
  const unpaidSum = unpaidInvoices.reduce((s, i) => s + invoiceTotals(i).toPay, 0);
  const overdue = unpaidInvoices.filter((i) => isOverdue(i));
  const overdueSum = overdue.reduce((s, i) => s + invoiceTotals(i).toPay, 0);

  // Kommande intäkter: godkända offerter som ännu inte fakturerats fullt ut.
  let upcomingIncome = 0;
  for (const q of data.quotes.filter((q) => q.status === "godkand")) {
    const v = data.quoteVersions.find((v) => v.id === q.currentVersionId);
    if (!v) continue;
    const total = v.lines.reduce((s, l) => s + Math.round(l.qty * l.unitPrice) * (1 + l.vatRate / 100), 0);
    const invoiced = data.invoices
      .filter((i) => i.quoteId === q.id && i.status !== "krediterad")
      .reduce((s, i) => s + invoiceTotals(i).total, 0);
    upcomingIncome += Math.max(0, Math.round(total) - invoiced);
  }

  return {
    revenueYear,
    revenueMonth,
    costsYear,
    profitYear: revenueYear - costsYear,
    unpaidCount: unpaidInvoices.length,
    unpaidSum,
    overdueCount: overdue.length,
    overdueSum,
    upcomingIncome,
  };
}
