import { normalizeMerchant } from "./banking/merchants";
import type { DocLine, RotRut, VerificationEntry } from "./types";
import { docTotals, vatBreakdown } from "./calc";
import { accountName } from "./accounting/chart";
import { REPRESENTATION_ANSWER } from "./expenses/manual-expense";

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
  /**
   * Kategorin konteras ALDRIG av `entriesExpense`. Avdraget och momsen beror
   * på uppgifter som varken banken eller kvittot bär, så konteringen räknas
   * fram av `representationSplit` (expenses/manual-expense.ts) först när
   * användaren svarat. `account` är då bara kontot kategorin visas med.
   */
  requiresConfirmedDetails?: true;
}

/**
 * Kategorier som `entriesExpense` kan kontera själv: kostnad plus moms mot
 * betalkontot. Listan är också kategorivalet i appen och alternativen vid en
 * kontorättelse, alltså allt som får bli en kontering av bara ett kategorival.
 * "Övrigt" ligger sist - `categoryByKey` faller tillbaka på den.
 */
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
  { key: "kost_resa", label: "Mat på tjänsteresa", account: 5831 },
  { key: "resa", label: "Resa & biljetter", account: 5810 },
  { key: "parkering", label: "Parkering, biltvätt & vägavgifter", account: 5619 },
  // Måltid åt ägaren/anställda utan kund: personalkostnad. Momsen lyfts inte –
  // en enskild måltid är i regel en kostförmån, och ett för lågt avdrag skapar
  // aldrig skatterisk.
  { key: "personal", label: "Personalmåltid", account: 7690, vatFree: true },
  { key: "konferens", label: "Konferens", account: 6991 },
  { key: "ovrigt", label: "Övrigt", account: 6991 },
];

/** Kategorinyckeln för representation - den enda som kräver bekräftade uppgifter. */
export const REPRESENTATION_CATEGORY_KEY = "representation";

/**
 * Kategorier som inte går att kontera av ett kategorival ensamt.
 *
 * Representation låg tidigare i listan ovan och pekade platt på 6072. Det var
 * fel: avdraget beror på hur många som deltog och om alkohol ingick, enklare
 * förtäring hör hemma på 6071/7631, och momsen lyfts efter schablon. Inget av
 * det går att läsa ur en banktransaktion.
 *
 * Valet här är att flytta nyckeln ut ur den konterbara listan i stället för
 * att ta bort den helt. Det ger minst specialfall: allt som bara ska kontera
 * en kategori (entriesExpense, kategorivalet i Ny utgift, kontorättelsens
 * alternativ) itererar EXPENSE_CATEGORIES och slutar därmed se representation,
 * utan att något av dem behöver känna till undantaget. Samtidigt finns nyckeln
 * kvar för `categoryByKey`, så kunskapsbasen (banking/merchants.ts), de lärda
 * leverantörsreglerna och redan bokförda utgifter behåller sin etikett i
 * stället för att tyst falla tillbaka på "Övrigt" (6991). `entriesExpense`
 * vägrar dessutom kontera en märkt kategori, som skydd mot en ny anropare.
 */
export const CONFIRMATION_REQUIRED_CATEGORIES: ExpenseCategory[] = [
  { key: REPRESENTATION_CATEGORY_KEY, label: REPRESENTATION_ANSWER, account: 6072, requiresConfirmedDetails: true },
];

/** Varje kategorinyckel som kan stå på en utgift, konterbar eller inte. */
export const ALL_EXPENSE_CATEGORIES: ExpenseCategory[] = [...EXPENSE_CATEGORIES, ...CONFIRMATION_REQUIRED_CATEGORIES];

export function categoryByKey(key: string): ExpenseCategory {
  return ALL_EXPENSE_CATEGORIES.find((c) => c.key === key) ?? EXPENSE_CATEGORIES[EXPENSE_CATEGORIES.length - 1];
}

/**
 * Pekar värdet ut representation? Tar både nyckeln ("representation") och
 * etiketten ("Kundrepresentation"), eftersom svaren i bokföringsfrågan och
 * assistentens verktygsargument bär etiketten.
 */
export function isRepresentationCategory(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === REPRESENTATION_CATEGORY_KEY || v === REPRESENTATION_ANSWER.toLowerCase();
}

export { REPRESENTATION_ANSWER };

/** Kontots namn ur kontoregistret, för "5410 Förbrukningsinventarier" i UI. */
export function categoryAccountName(key: string): string {
  return accountName(categoryByKey(key).account);
}

/**
 * Kategori ur den generella kunskapsbasen (banking/merchants.ts). Motparter
 * utan privat-/momsrisk (bygghandel, grossist, telekom, försäkring, program-
 * vara) ger hög säkerhet – med kvitto bokförs de automatiskt. Riskmotparter
 * (drivmedel, restaurang, dagligvaror, hotell …) ger bara ett förslag: Shell
 * kan vara butik eller privat, McDonald's är inte "mat". Företagets egna
 * regler (services/expenses.ts) väger alltid tyngre än kunskapsbasen.
 */
export function guessCategory(supplier: string): { key: string; confidence: "hog" | "medel" | "lag" } | null {
  const merchant = normalizeMerchant(supplier);
  const knowledge = merchant.knowledge;
  if (knowledge && knowledge.categories.length > 0) {
    return { key: knowledge.categories[0], confidence: knowledge.autoBookWithReceipt ? "hog" : "medel" };
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

/**
 * Utgift (kvitto): kostnad + ingående moms mot det konto som betalade –
 * företagskontot (1930) som standard, eller skuld till ägaren (2893) när
 * ägaren la ut privat och bolaget ska betala tillbaka.
 *
 * Kategorier som kräver bekräftade uppgifter (representation) konteras inte
 * här. Den generiska konteringen kan bara dela beloppet i kostnad och moms,
 * och för representation är just den delningen hela frågan.
 */
export function entriesExpense(
  categoryKey: string,
  amount: number,
  vatAmount: number,
  settlementAccount: number = 1930
): VerificationEntry[] {
  const cat = categoryByKey(categoryKey);
  if (cat.requiresConfirmedDetails) {
    throw new Error(
      `${cat.label} kan inte bokföras utan antal personer och om alkohol ingick - uppdelningen görs av representationSplit när frågan är besvarad.`
    );
  }
  if (cat.reverseChargeRate) return entriesReverseChargePurchase(cat, amount, settlementAccount);
  const net = amount - vatAmount;
  const entries: VerificationEntry[] = [e(cat.account, net, 0)];
  if (vatAmount > 0) entries.push(e(2641, vatAmount, 0));
  entries.push(e(settlementAccount, 0, amount));
  return entries;
}

/**
 * Verifikationsrader ur en färdigräknad kontering (manuella utgifter:
 * milersättning, traktamente, representation – se expenses/manual-expense.ts).
 * Kontonamnen slås upp här så att den rena planeringsmodulen slipper registret.
 */
export function entriesFromPostingLines(lines: readonly { account: number; debit: number; credit: number }[]): VerificationEntry[] {
  return lines.filter((l) => l.debit > 0 || l.credit > 0).map((l) => e(l.account, l.debit, l.credit));
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

/** Inbetalning från företagskontot till skattekontot (samma som bank-kind `skattekonto`). */
export function entriesTaxAccountDeposit(amount: number): VerificationEntry[] {
  return [e(1630, amount, 0), e(1930, 0, amount)];
}

/** Skatteverkets debitering av F-skatt: 2518 mot 1630. */
export function entriesFSkattCharge(amount: number): VerificationEntry[] {
  return [e(2518, amount, 0), e(1630, 0, amount)];
}

export { isCostAccount, isRevenueAccount } from "./accounting/chart";

