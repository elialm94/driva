import type { DocLine, RotRut, VerificationEntry } from "./types";
import { docTotals, vatBreakdown } from "./calc";

const SALES_BY_VAT: Record<number, number> = { 25: 3001, 12: 3002, 6: 3003, 0: 3004 };
const VAT_OUT_BY_RATE: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };

/** Utdrag ur BAS-kontoplanen – det som produkten använder. Utökas vid behov, aldrig hela registret. */
export const BAS: Record<number, string> = {
  1220: "Inventarier och verktyg",
  1229: "Ack. avskrivningar inventarier",
  1510: "Kundfordringar",
  1513: "Kundfordringar ROT/RUT",
  1710: "Förutbetalda kostnader",
  1790: "Upplupna intäkter",
  1930: "Företagskonto",
  2010: "Eget kapital (enskild firma)",
  2013: "Egna uttag",
  2018: "Egna insättningar",
  2019: "Årets resultat (enskild firma)",
  2081: "Aktiekapital",
  2091: "Balanserad vinst eller förlust",
  2099: "Årets resultat",
  2440: "Leverantörsskulder",
  2510: "Skatteskulder",
  2512: "Beräknad inkomstskatt",
  2611: "Utgående moms 25 %",
  2621: "Utgående moms 12 %",
  2631: "Utgående moms 6 %",
  2641: "Ingående moms",
  2650: "Redovisningskonto för moms",
  2970: "Förutbetalda intäkter",
  2990: "Upplupna kostnader",
  3001: "Försäljning 25 %",
  3002: "Försäljning 12 %",
  3003: "Försäljning 6 %",
  3004: "Försäljning 0 %",
  4010: "Material och varor",
  5010: "Lokalhyra",
  5410: "Förbrukningsinventarier",
  5420: "Programvaror och licenser",
  5611: "Drivmedel",
  5831: "Kost och logi",
  6072: "Representation",
  6310: "Företagsförsäkringar",
  6212: "Telefon och internet",
  6991: "Övriga externa kostnader",
  7832: "Avskrivningar inventarier och verktyg",
  8910: "Skatt på årets resultat",
  8999: "Årets resultat",
};

export interface ExpenseCategory {
  key: string;
  label: string;
  account: number;
  /** Om inköpet normalt saknar avdragsgill moms (t.ex. momsfri hyra/försäkring). */
  vatFree?: boolean;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: "material", label: "Material", account: 4010 },
  { key: "verktyg", label: "Verktyg & förbrukning", account: 5410 },
  { key: "drivmedel", label: "Drivmedel", account: 5611 },
  { key: "programvara", label: "Programvara & licenser", account: 5420 },
  { key: "telefon", label: "Telefon & internet", account: 6212 },
  { key: "hyra", label: "Lokalhyra", account: 5010, vatFree: true },
  { key: "forsakring", label: "Försäkring", account: 6310, vatFree: true },
  { key: "hotell", label: "Hotell & logi", account: 5831 },
  { key: "representation", label: "Kundrepresentation", account: 6072 },
  { key: "konferens", label: "Konferens", account: 6991 },
  { key: "ovrigt", label: "Övrigt", account: 6991 },
];

export function categoryByKey(key: string): ExpenseCategory {
  return EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

/** Leverantörer som produkten känner igen → hög säkerhet vid klassificering. */
export const KNOWN_SUPPLIERS: Record<string, string> = {
  bauhaus: "material",
  "beijer bygg": "material",
  beijer: "material",
  byggmax: "material",
  "xl-bygg": "material",
  "clas ohlson": "verktyg",
  jula: "verktyg",
  "circle k": "drivmedel",
  okq8: "drivmedel",
  preem: "drivmedel",
  adobe: "programvara",
  fortnox: "programvara",
  telia: "telefon",
  telenor: "telefon",
  tele2: "telefon",
  "trygg-hansa": "forsakring",
  if: "forsakring",
};

export function guessCategory(supplier: string): { key: string; confidence: "hog" | "medel" | "lag" } | null {
  const s = supplier.toLowerCase();
  for (const [name, key] of Object.entries(KNOWN_SUPPLIERS)) {
    if (s.includes(name)) return { key, confidence: "hog" };
  }
  if (/(hotel|hotell|hôtel)/i.test(supplier)) return { key: "hotell", confidence: "lag" };
  return null;
}

function e(account: number, debit: number, credit: number): VerificationEntry {
  return { account, accountName: BAS[account] ?? `Konto ${account}`, debit, credit };
}

/* ------------------------- Verifikationsbyggare (rena) ------------------------- */

function entriesSalesAndVat(lines: DocLine[], reverse: boolean): VerificationEntry[] {
  const entries: VerificationEntry[] = [];
  for (const row of vatBreakdown(lines)) {
    const salesAcc = SALES_BY_VAT[row.rate] ?? 3001;
    if (row.base) entries.push(reverse ? e(salesAcc, row.base, 0) : e(salesAcc, 0, row.base));
    if (row.vat) {
      const vatAcc = VAT_OUT_BY_RATE[row.rate] ?? 2611;
      entries.push(reverse ? e(vatAcc, row.vat, 0) : e(vatAcc, 0, row.vat));
    }
  }
  return entries;
}

/** Kundfaktura skickad: fordran mot kund (och Skatteverket vid ROT/RUT), intäkt + utgående moms per sats. */
export function entriesInvoiceSent(lines: DocLine[], rot: RotRut | null): VerificationEntry[] {
  const t = docTotals(lines, rot);
  const entries: VerificationEntry[] = [e(1510, t.toPay, 0)];
  if (t.deduction > 0) entries.push(e(1513, t.deduction, 0));
  entries.push(...entriesSalesAndVat(lines, false));
  return entries;
}

export function entriesInvoicePaid(amount: number): VerificationEntry[] {
  return [e(1930, amount, 0), e(1510, 0, amount)];
}

export function entriesCredit(lines: DocLine[], rot: RotRut | null): VerificationEntry[] {
  const t = docTotals(lines, rot);
  const entries: VerificationEntry[] = [...entriesSalesAndVat(lines, true)];
  entries.push(e(1510, 0, t.toPay));
  if (t.deduction > 0) entries.push(e(1513, 0, t.deduction));
  return entries;
}

/** Utgift betald direkt från banken (kvitto): kostnad + ingående moms mot företagskontot. */
export function entriesExpense(categoryKey: string, amount: number, vatAmount: number): VerificationEntry[] {
  const cat = categoryByKey(categoryKey);
  const net = amount - vatAmount;
  const entries: VerificationEntry[] = [e(cat.account, net, 0)];
  if (vatAmount > 0) entries.push(e(2641, vatAmount, 0));
  entries.push(e(1930, 0, amount));
  return entries;
}

/** Leverantörsfaktura mottagen: kostnad + ingående moms mot leverantörsskuld. */
export function entriesSupplierInvoiceReceived(
  categoryKey: string,
  amount: number,
  vatAmount: number
): VerificationEntry[] {
  const cat = categoryByKey(categoryKey);
  const net = amount - vatAmount;
  const entries: VerificationEntry[] = [e(cat.account, net, 0)];
  if (vatAmount > 0) entries.push(e(2641, vatAmount, 0));
  entries.push(e(2440, 0, amount));
  return entries;
}

export function entriesSupplierInvoicePaid(amount: number): VerificationEntry[] {
  return [e(2440, amount, 0), e(1930, 0, amount)];
}

export function entriesTaxPayment(amount: number): VerificationEntry[] {
  return [e(2510, amount, 0), e(1930, 0, amount)];
}

/* ------------------------------- Rapportberäkning ------------------------------ */

export function isRevenueAccount(account: number): boolean {
  return account >= 3000 && account < 4000;
}

export function isCostAccount(account: number): boolean {
  return account >= 4000 && account < 8000;
}

