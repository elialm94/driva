import type { DocLine, RotRut, VerificationEntry } from "./types";
import { docTotals, vatBreakdown } from "./calc";
import { accountName } from "./accounting/chart";

const SALES_BY_VAT: Record<number, number> = { 25: 3001, 12: 3002, 6: 3003, 0: 3004 };
const VAT_OUT_BY_RATE: Record<number, number> = { 25: 2611, 12: 2621, 6: 2631 };

/** Omvänd byggmoms: säljarens omsättning, köparens underlag och köparens moms. */
const REVERSE_CHARGE_SALES = 3231;
const REVERSE_CHARGE_PURCHASE_VAT_OUT = 2614;
const REVERSE_CHARGE_PURCHASE_VAT_IN = 2647;

/**
 * Utgiftskategori: en genväg i UI:t till ett konto i registret. Kategorin äger
 * bara sitt visningsnamn och sin momsregel – kontonamnet kommer alltid ur
 * kontoregistret via `categoryAccountName`, så kontoplanen har en sanning.
 */
export interface ExpenseCategory {
  key: string;
  label: string;
  account: number;
  /** Om inköpet normalt saknar avdragsgill moms (t.ex. momsfri hyra/försäkring). */
  vatFree?: boolean;
  /**
   * Omvänd skattskyldighet: leverantören fakturerar utan moms och köparen
   * redovisar både utgående och ingående moms själv. Satsen är den som skulle
   * gällt om säljaren fakturerat momsen – byggtjänster är alltid 25 %.
   */
  reverseChargeRate?: 25 | 12 | 6;
}

export const EXPENSE_CATEGORIES: ExpenseCategory[] = [
  { key: "material", label: "Material", account: 4010 },
  { key: "byggtjanster_omvand", label: "Inköpt byggtjänst (omvänd byggmoms)", account: 4425, reverseChargeRate: 25 },
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

/** Kontots namn ur kontoregistret, för "5410 Förbrukningsinventarier" i UI. */
export function categoryAccountName(key: string): string {
  return accountName(categoryByKey(key).account);
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
  return { account, accountName: accountName(account), debit, credit };
}

/* ------------------------- Verifikationsbyggare (rena) ------------------------- */

/**
 * Hur en faktura ska konteras utöver raderna själva.
 * `reverseCharge` = omvänd byggmoms: omsättningen hamnar på 3231 i stället
 * för momsfri försäljning, eftersom ruta 41 och ruta 42 är olika rutor i
 * momsdeklarationen.
 */
export interface SalesPostingOptions {
  reverseCharge?: boolean;
}

/** `credit` vänder tecknen: samma rader, kreditfakturans riktning. */
function entriesSalesAndVat(
  lines: DocLine[],
  credit: boolean,
  opts: SalesPostingOptions = {}
): VerificationEntry[] {
  const entries: VerificationEntry[] = [];
  for (const row of vatBreakdown(lines)) {
    const salesAcc = opts.reverseCharge && row.rate === 0 ? REVERSE_CHARGE_SALES : (SALES_BY_VAT[row.rate] ?? 3001);
    if (row.base) entries.push(credit ? e(salesAcc, row.base, 0) : e(salesAcc, 0, row.base));
    if (row.vat) {
      const vatAcc = VAT_OUT_BY_RATE[row.rate] ?? 2611;
      entries.push(credit ? e(vatAcc, row.vat, 0) : e(vatAcc, 0, row.vat));
    }
  }
  return entries;
}

/** Kundfaktura skickad: fordran mot kund (och Skatteverket vid ROT/RUT), intäkt + utgående moms per sats. */
export function entriesInvoiceSent(
  lines: DocLine[],
  rot: RotRut | null,
  opts: SalesPostingOptions = {}
): VerificationEntry[] {
  const t = docTotals(lines, rot);
  const entries: VerificationEntry[] = [e(1510, t.toPay, 0)];
  if (t.deduction > 0) entries.push(e(1513, t.deduction, 0));
  entries.push(...entriesSalesAndVat(lines, false, opts));
  return entries;
}

export function entriesInvoicePaid(amount: number): VerificationEntry[] {
  return [e(1930, amount, 0), e(1510, 0, amount)];
}

/**
 * Kundinbetalning – bokar ALLTID det faktiska bankbeloppet mot 1930.
 * Fordran (1510) bockas av med `settleReceivable`; skillnader hanteras öppet:
 *
 *   * `oresDiff` (± inom öres-toleransen, se autopilot.ORE_TOLERANS_KR)
 *     bokas på 3740 Öres- och kronutjämning: positiv = kunden betalade för
 *     lite (kostnad, debet), negativ = för mycket (intäkt, kredit).
 *   * `excessToCustomerCredit` (överbetalning utöver toleransen) bokas som
 *     skuld till kunden på 2420 Förskott från kunder – aldrig som intäkt.
 *
 * Invarianten bankAmount + max(0, oresDiff) = settleReceivable +
 * max(0, -oresDiff) + excessToCustomerCredit måste hålla (debet = kredit);
 * postVerification vägrar annars.
 */
export function entriesInvoicePaymentReceived(input: {
  bankAmount: number;
  settleReceivable: number;
  oresDiff?: number;
  excessToCustomerCredit?: number;
}): VerificationEntry[] {
  const oresDiff = input.oresDiff ?? 0;
  const excess = input.excessToCustomerCredit ?? 0;
  const entries: VerificationEntry[] = [e(1930, input.bankAmount, 0)];
  if (oresDiff > 0) entries.push(e(3740, oresDiff, 0));
  entries.push(e(1510, 0, input.settleReceivable));
  if (oresDiff < 0) entries.push(e(3740, 0, -oresDiff));
  if (excess > 0) entries.push(e(2420, 0, excess));
  return entries;
}

/**
 * Skatteverket betalar ut ROT/RUT: pengarna in på företagskontot och
 * fordran på Skatteverket (1513) bockas av. Ingen intäkt – den bokfördes
 * när fakturan utfärdades.
 */
export function entriesTaxReductionPayout(amount: number): VerificationEntry[] {
  return [e(1930, amount, 0), e(1513, 0, amount)];
}

/**
 * Återbetalning till kund. Skulden kan sitta på två ställen:
 *   * 2420 Förskott från kunder – överbetalning som bokades som skuld.
 *   * 1510 Kundfordringar (negativ) – kreditering av en redan betald faktura.
 * Utbetalningen nollställer båda mot företagskontot.
 */
export function entriesCustomerRefund(input: { fromOverpayment: number; fromCredit: number }): VerificationEntry[] {
  const entries: VerificationEntry[] = [];
  if (input.fromOverpayment > 0) entries.push(e(2420, input.fromOverpayment, 0));
  if (input.fromCredit > 0) entries.push(e(1510, input.fromCredit, 0));
  entries.push(e(1930, 0, input.fromOverpayment + input.fromCredit));
  return entries;
}

/**
 * Skatteverket nekade (en del av) ROT/RUT-utbetalningen och kunden faktureras
 * restbeloppet: fordran flyttas från Skatteverket (1513) till kunden (1510).
 * Ingen ny intäkt eller utgående moms – de redovisades på ursprungsfakturan.
 */
export function entriesDeniedReductionInvoice(amount: number): VerificationEntry[] {
  return [e(1510, amount, 0), e(1513, 0, amount)];
}

/** Kreditering av en restfaktura för nekat avdrag: flytta tillbaka fordran till Skatteverket. */
export function entriesDeniedReductionCredit(amount: number): VerificationEntry[] {
  return [e(1513, amount, 0), e(1510, 0, amount)];
}

export function entriesCredit(
  lines: DocLine[],
  rot: RotRut | null,
  opts: SalesPostingOptions = {}
): VerificationEntry[] {
  const t = docTotals(lines, rot);
  const entries: VerificationEntry[] = [...entriesSalesAndVat(lines, true, opts)];
  entries.push(e(1510, 0, t.toPay));
  if (t.deduction > 0) entries.push(e(1513, 0, t.deduction));
  return entries;
}

/**
 * Momsen som får lyftas som ingående moms. Kategorin äger regeln, inte
 * anroparen: momsfria kategorier lyfter ingenting, och vid omvänd
 * skattskyldighet står det ingen moms på leverantörens faktura att lyfta –
 * den räknas fram ur beloppet i stället (entriesReverseChargePurchase).
 */
export function deductibleVat(categoryKey: string, vatAmount: number): number {
  const cat = categoryByKey(categoryKey);
  if (cat.vatFree || cat.reverseChargeRate) return 0;
  return vatAmount;
}

/**
 * Inköp med omvänd skattskyldighet. Leverantören fakturerar utan moms, så
 * `amount` är hela beloppet som ska betalas. Köparen redovisar momsen på
 * beloppet som utgående moms och drar av den som ingående moms – nettot mot
 * Skatteverket blir noll, men båda leden måste synas i deklarationen.
 */
function entriesReverseChargePurchase(
  cat: ExpenseCategory,
  amount: number,
  settlementAccount: number
): VerificationEntry[] {
  const vat = Math.round(amount * ((cat.reverseChargeRate ?? 25) / 100));
  return [
    e(cat.account, amount, 0),
    e(REVERSE_CHARGE_PURCHASE_VAT_IN, vat, 0),
    e(REVERSE_CHARGE_PURCHASE_VAT_OUT, 0, vat),
    e(settlementAccount, 0, amount),
  ];
}

/** Utgift betald direkt från banken (kvitto): kostnad + ingående moms mot företagskontot. */
export function entriesExpense(categoryKey: string, amount: number, vatAmount: number): VerificationEntry[] {
  const cat = categoryByKey(categoryKey);
  if (cat.reverseChargeRate) return entriesReverseChargePurchase(cat, amount, 1930);
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
  if (cat.reverseChargeRate) return entriesReverseChargePurchase(cat, amount, 2440);
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

export { isCostAccount, isRevenueAccount } from "./accounting/chart";

