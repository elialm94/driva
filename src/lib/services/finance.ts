import { db } from "../store";
import { docTotals } from "../calc";
import { countsTowardInvoiced, invoiceOutstanding, invoiceTotals, isOpenReceivable, isOverdue } from "./data";
import { currentVatPosition } from "../accounting/vat";
import { accountBalance, resultatrapport } from "../accounting/ledger";
import { todayDate } from "../accounting/dates";
import { SKATTEKONTO } from "../accounting/tax-account";

/** Innevarande momsperiod med deklarations- och betaldatum. */
export function momsPeriod() {
  const pos = currentVatPosition();
  return {
    start: pos.period.start,
    end: pos.period.end,
    due: `${pos.dueDate}T12:00:00.000Z`,
    namn: pos.period.label,
  };
}

/** Momsberäkning från huvudboken (alla momssatser) – samma siffror som momsrapporten. */
export function momsForCurrentPeriod() {
  const pos = currentVatPosition();
  return {
    utgaende: pos.utgaende,
    ingaende: pos.ingaende,
    attBetala: pos.attBetala,
    due: `${pos.dueDate}T12:00:00.000Z`,
    namn: pos.period.label,
  };
}

export interface FinanceOverview {
  bank: number;
  moms: number;
  momsDue: string;
  fSkatt: number;
  payrollReserve: number;
  /** Saldo på skattekontot. Positivt = tillgodo hos Skatteverket, negativt = skuld. */
  taxAccount: number;
  reserved: number;
  upcoming: number;
  upcomingRows: { label: string; amount: number; due: string }[];
  available: number;
}

/** Den enkla ekonomiska överblicken: banken, reserverat, kommande, ungefär tillgängligt. */
export function financeOverview(): FinanceOverview {
  const data = db();
  // Banksiffran härleds ur HUVUDBOKEN (1930), aldrig ur bankens muterbara
  // saldofält – bokföringen är sanningen och avstämningen (reconciliation.ts)
  // visar diffen mot bankens uppgift som en egen exception.
  const bank = accountBalance(1930, todayDate());
  const momsNu = momsForCurrentPeriod();
  // Reserv för moms: innevarande period + deklarerad men obetald moms (2650 kredit).
  const declaredUnpaid = Math.max(0, -accountBalance(2650, todayDate()));
  const moms = Math.max(0, momsNu.attBetala) + declaredUnpaid;
  const momsDue = momsNu.due;
  // Reserv: kommande två månaders F-skatt + en månads arbetsgivaravgifter/personalskatt.
  const fSkatt = data.settings.fSkattPerMonth * 2;
  const payrollReserve = data.settings.payrollReservePerMonth;
  // Skattekontot: pengar som redan lämnat 1930 (och därmed `bank`) behöver inte
  // reserveras en gång till, medan en skuld på kontot är precis vad reserven
  // finns till för. Positivt saldo = tillgodo hos Skatteverket.
  const taxAccount = accountBalance(SKATTEKONTO, todayDate());
  const behov = moms + fSkatt + payrollReserve;
  const reserved = Math.max(0, behov - Math.max(0, taxAccount)) + Math.max(0, -taxAccount);
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
    taxAccount,
    reserved,
    upcoming,
    upcomingRows,
    available: bank - reserved - upcoming,
  };
}

/** Nyckeltal för Ekonomi-sidan och assistenten – samma motor som rapporterna. */
export function businessStats() {
  const data = db();
  const today = todayDate();
  const year = resultatrapport(); // räkenskapsåret hittills
  const month = resultatrapport({ from: `${today.slice(0, 7)}-01`, to: today });

  const revenueYear = year.omsattning;
  const revenueMonth = month.omsattning;
  const costsYear = year.kostnaderSumma;

  const unpaidInvoices = data.invoices.filter(isOpenReceivable);
  const unpaidSum = unpaidInvoices.reduce((s, i) => s + invoiceOutstanding(i), 0);
  const overdue = unpaidInvoices.filter((i) => isOverdue(i));
  const overdueSum = overdue.reduce((s, i) => s + invoiceOutstanding(i), 0);

  // Kommande intäkter: godkända offerter som ännu inte fakturerats fullt ut.
  // Samma totalberäkning (docTotals) som offerter, fakturor och bokföring använder.
  let upcomingIncome = 0;
  for (const q of data.quotes.filter((q) => q.status === "godkand")) {
    const v = data.quoteVersions.find((v) => v.id === q.currentVersionId);
    if (!v) continue;
    const total = docTotals(v.lines, v.rot).total;
    const invoiced = data.invoices
      .filter((i) => i.quoteId === q.id && countsTowardInvoiced(i))
      .reduce((s, i) => s + invoiceTotals(i).total, 0);
    upcomingIncome += Math.max(0, total - invoiced);
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
