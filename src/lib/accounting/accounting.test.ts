process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, labor, rotReadyCustomer } from "../invoices/test-db";
import { createInvoice, creditInvoice, issueInvoice, markInvoicePaid } from "../services/invoices";
import { answerExpenseQuestion, undoExpenseBooking } from "../services/expenses";
import { receiveSupplierInvoice } from "../services/suppliers";
import { paySupplierInvoice, simulateIncomingPayment } from "../services/banking";
import { postVerification, createCorrection, PostingError, validateEntries } from "./engine";
import { accountBalance, balansrapport, ledgerIntegrity, saldobalans, huvudbok } from "./ledger";
import { computeVatPosition, generateVatReport, markVatReportDeclared, vatPeriods } from "./vat";
import { lockPeriod, isDateLocked, clampToOpenDate, fiscalYears, ensureFiscalYearFor } from "./fiscal";
import { registerAssetFromExpense, createDepreciationEntry, depreciationForYear, INVENTARIE_GRANS, bookValue } from "./assets";
import { planAccrual, bookAccrual, reverseAccrualsInto, amountAfterYearEnd } from "./accruals";
import { bokslutChecklist, closeFiscalYear, runBokslutAutomation } from "./close";
import { bankReconciliation } from "./reconciliation";
import { computeTaxCalculation } from "./tax";
import { generateSie, encodeSieToPc8 } from "./sie";
import type { BankAccount, Expense } from "../types";

/**
 * Domäntester för bokföringsmotorn: hela kedjan affärshändelse → verifikation
 * → huvudbok → avstämning → moms → bokslut. Körs mot in-memory-databasen.
 */

const THIS_YEAR = Number(new Date().toISOString().slice(0, 4));
const LAST_YEAR = THIS_YEAR - 1;

function bankAccount(balance = 0): BankAccount {
  return { id: "bank-1", name: "Företagskonto", accountNumber: "1234-5678", balance } as BankAccount;
}

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb({ customers: [rotReadyCustomer()], bankAccounts: [bankAccount()], ...over }));
}

function unansweredExpense(over: Partial<Expense> = {}): Expense {
  const expense: Expense = {
    id: over.id ?? "exp-1",
    supplier: over.supplier ?? "Bauhaus",
    date: over.date ?? new Date().toISOString(),
    amount: over.amount ?? 1250,
    vatAmount: over.vatAmount ?? 250,
    description: over.description,
    category: over.category,
    status: "behover_svar",
    question: { text: "Vad gällde köpet?", options: ["Material", "Annat"] },
    createdAt: new Date().toISOString(),
    ...over,
  };
  db().expenses.push(expense);
  return expense;
}

function balanced(entries: { debit: number; credit: number }[]): boolean {
  return entries.reduce((s, e) => s + e.debit - e.credit, 0) === 0;
}

/* ------------------------------ Motorn: validering ----------------------------- */

describe("Verifikationsmotorn", () => {
  beforeEach(() => reset());

  it("vägrar obalanserade verifikationer – inget sparas", () => {
    const before = db().verifications.length;
    assert.throws(
      () =>
        postVerification({
          date: new Date().toISOString(),
          description: "Obalanserad",
          entries: [
            { account: 1930, debit: 100 },
            { account: 3001, credit: 90 },
          ],
          source: { type: "manuell" },
          createdBy: "anvandare",
        }),
      (e: unknown) => e instanceof PostingError && e.code === "obalanserad"
    );
    assert.equal(db().verifications.length, before);
  });

  it("vägrar okända konton – bokföringen hittar inte på konton", () => {
    assert.throws(
      () =>
        postVerification({
          date: new Date().toISOString(),
          description: "Påhittat konto",
          entries: [
            { account: 9999, debit: 100 },
            { account: 1930, credit: 100 },
          ],
          source: { type: "manuell" },
          createdBy: "assistent",
        }),
      (e: unknown) => e instanceof PostingError && e.code === "okant_konto"
    );
  });

  it("vägrar negativa belopp och ören", () => {
    assert.throws(() => validateEntries([{ account: 1930, debit: -5 }, { account: 3001, credit: -5 }]));
    assert.throws(() => validateEntries([{ account: 1930, debit: 10.5 }, { account: 3001, credit: 10.5 }]));
  });

  it("tilldelar löpnummer atomiskt i serie A", () => {
    const post = () =>
      postVerification({
        date: new Date().toISOString(),
        description: "Test",
        entries: [
          { account: 1930, debit: 100 },
          { account: 3001, credit: 100 },
        ],
        source: { type: "manuell" },
        createdBy: "anvandare",
      });
    const numbers = [post().number, post().number, post().number];
    assert.deepEqual(numbers, [1, 2, 3]);
    assert.ok(db().verifications.every((v) => v.series === "A" && v.status === "bokford" && v.postedAt));
  });

  it("kopplar verifikationen till rätt räkenskapsår (skapas vid behov)", () => {
    const v = postVerification({
      date: `${LAST_YEAR}-03-10T12:00:00Z`,
      description: "Föregående år",
      entries: [
        { account: 1930, debit: 100 },
        { account: 3001, credit: 100 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const fy = db().fiscalYears.find((f) => f.id === v.fiscalYearId);
    assert.equal(fy?.label, String(LAST_YEAR));
  });
});

/* ------------------------------- Rättelser & ångra ------------------------------ */

describe("Rättelser", () => {
  beforeEach(() => reset());

  it("rättelse återför originalet men lämnar det orört", () => {
    const original = postVerification({
      date: new Date().toISOString(),
      description: "Felbokning",
      entries: [
        { account: 4010, debit: 800 },
        { account: 2641, debit: 200 },
        { account: 1930, credit: 1000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const entriesBefore = JSON.stringify(original.entries);

    const { reversal } = createCorrection({ verificationId: original.id, reason: "fel kategori", by: "anvandare" });

    assert.equal(JSON.stringify(db().verifications.find((v) => v.id === original.id)!.entries), entriesBefore);
    assert.equal(original.correctedByVerificationId, reversal.id);
    assert.equal(reversal.correctsVerificationId, original.id);
    // Återföringen speglar debet/kredit.
    assert.equal(reversal.entries.find((e) => e.account === 1930)!.debit, 1000);
    assert.equal(reversal.entries.find((e) => e.account === 4010)!.credit, 800);
    // Nettot på kontona är noll.
    assert.equal(accountBalance(4010), 0);
    assert.equal(accountBalance(1930), 0);
    // Dubbelrättelse stoppas.
    assert.throws(
      () => createCorrection({ verificationId: original.id, reason: "igen", by: "anvandare" }),
      (e: unknown) => e instanceof PostingError && e.code === "redan_rattad"
    );
  });

  it("ångra utgift skapar rättelse och öppnar frågan igen", () => {
    const expense = unansweredExpense();
    answerExpenseQuestion(expense.id, "Material");
    assert.equal(expense.status, "bokford");
    const verId = expense.verificationId!;

    undoExpenseBooking(expense.id);
    assert.equal(expense.status, "behover_svar");
    assert.equal(expense.verificationId, undefined);
    const original = db().verifications.find((v) => v.id === verId)!;
    assert.ok(original.correctedByVerificationId);
    assert.equal(accountBalance(4010), 0);
  });
});

/* ------------------------------ Kundfakturakedjan ------------------------------ */

describe("Kundfakturor", () => {
  beforeEach(() => reset());

  it("utfärdad faktura bokförs balanserat: 1510 / 3001 / 2611", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const ver = db().verifications.find((v) => v.source.type === "kundfaktura")!;
    assert.ok(balanced(ver.entries));
    assert.equal(ver.entries.find((e) => e.account === 1510)!.debit, 12_500);
    assert.equal(ver.entries.find((e) => e.account === 3001)!.credit, 10_000);
    assert.equal(ver.entries.find((e) => e.account === 2611)!.credit, 2_500);
    assert.ok(ver.explanation && ver.explanation.length > 10);
  });

  it("betalning bockar av kundfordran: 1930 / 1510", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    assert.equal(accountBalance(1510), 0);
    assert.equal(accountBalance(1930), 12_500);
    assert.equal(db().invoices.find((i) => i.id === inv.id)!.status, "betald");
  });

  it("kreditfaktura återför intäkt, moms och fordran", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    creditInvoice(inv.id);
    assert.equal(accountBalance(1510), 0);
    assert.equal(accountBalance(3001), 0);
    assert.equal(accountBalance(2611), 0);
    assert.ok(ledgerIntegrity().balanced);
  });

  it("ROT-faktura lägger avdraget som fordran på Skatteverket (1513)", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 20_000 })],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    const ver = db().verifications.find((v) => v.source.type === "kundfaktura")!;
    assert.ok(balanced(ver.entries));
    const rotClaim = ver.entries.find((e) => e.account === 1513);
    assert.ok(rotClaim && rotClaim.debit > 0, "1513 ska debiteras med ROT-avdraget");
    const kund = ver.entries.find((e) => e.account === 1510)!;
    assert.equal(kund.debit + rotClaim.debit, 25_000);
  });

  it("simulerad inbetalning matchar via OCR och stämmer av banken", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 8_000 })], rot: null });
    issueInvoice(inv.id);
    simulateIncomingPayment(inv.id);
    const recon = bankReconciliation();
    assert.equal(recon.difference, 0);
    assert.equal(recon.unhandled.length, 0);
    assert.ok(recon.ok);
    assert.equal(db().bankTransactions[0].status, "bokford");
  });
});

/* -------------------------------- Utgifter/kvitton ------------------------------ */

describe("Utgifter", () => {
  beforeEach(() => reset());

  it("svar på fråga bokför balanserat: kostnad + moms + bank", () => {
    const expense = unansweredExpense({ amount: 1250, vatAmount: 250 });
    answerExpenseQuestion(expense.id, "Material");
    const ver = db().verifications.find((v) => v.source.type === "utgift")!;
    assert.ok(balanced(ver.entries));
    assert.equal(ver.entries.find((e) => e.account === 4010)!.debit, 1000);
    assert.equal(ver.entries.find((e) => e.account === 2641)!.debit, 250);
    assert.equal(ver.entries.find((e) => e.account === 1930)!.credit, 1250);
    assert.equal(expense.status, "bokford");
  });

  it("momsfri kategori lyfter ingen moms", () => {
    const expense = unansweredExpense({ id: "exp-p", supplier: "Parkering AB", amount: 500, vatAmount: 0 });
    answerExpenseQuestion(expense.id, "Annat");
    const ver = db().verifications.find((v) => v.source.type === "utgift")!;
    assert.ok(balanced(ver.entries));
    assert.equal(ver.entries.some((e) => e.account === 2641), false);
  });
});

/* ----------------------------- Leverantörsfakturor ------------------------------ */

describe("Leverantörsfakturor", () => {
  beforeEach(() => reset());

  it("mottagen faktura bokförs mot 2440 med ingående moms", () => {
    const sup = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "F-1001",
      amount: 5_000,
      vatAmount: 1_000,
      description: "Material",
      category: "material",
    });
    const ver = db().verifications.find((v) => v.id === sup.verificationId)!;
    assert.ok(balanced(ver.entries));
    assert.equal(ver.entries.find((e) => e.account === 4010)!.debit, 4_000);
    assert.equal(ver.entries.find((e) => e.account === 2641)!.debit, 1_000);
    assert.equal(ver.entries.find((e) => e.account === 2440)!.credit, 5_000);
    assert.equal(accountBalance(2440), -5_000);
  });

  it("betalning bockar av leverantörsskulden: 2440 / 1930", () => {
    const sup = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "F-1001",
      amount: 5_000,
      vatAmount: 1_000,
      description: "Material",
      category: "material",
    });
    paySupplierInvoice(sup.id);
    assert.equal(accountBalance(2440), 0);
    assert.equal(accountBalance(1930), -5_000);
    assert.equal(sup.status, "betald");
    assert.ok(sup.paymentVerificationId);
  });
});

/* ------------------------------ Huvudbok & saldobalans -------------------------- */

describe("Huvudbok och saldobalans", () => {
  beforeEach(() => reset());

  it("saldobalansen balanserar: summa debet = summa kredit", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const expense = unansweredExpense();
    answerExpenseQuestion(expense.id, "Material");
    const sb = saldobalans();
    assert.equal(sb.sumDebit, sb.sumCredit);
    assert.equal(sb.sumUb, 0); // inga IB → UB summerar till 0
    assert.ok(ledgerIntegrity().balanced);
  });

  it("huvudboken har IB + rader + löpande saldo = UB", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 4_000 })], rot: null });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    const konto1930 = huvudbok({ account: 1930 })[0];
    assert.equal(konto1930.ib, 0);
    assert.equal(konto1930.rows.length, 1);
    assert.equal(konto1930.rows.at(-1)!.balance, konto1930.ub);
    assert.equal(konto1930.ub, 5_000);
  });

  it("balansrapporten går ihop med beräknat resultat", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const br = balansrapport();
    assert.equal(br.differens, 0);
    assert.equal(br.beraknatResultat, 10_000);
  });
});

/* -------------------------------------- Moms ----------------------------------- */

describe("Moms", () => {
  beforeEach(() => reset());

  it("momsrapporten matchar de underliggande verifikationerna", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const expense = unansweredExpense({ amount: 1_250, vatAmount: 250 });
    answerExpenseQuestion(expense.id, "Material");

    const fy = ensureFiscalYearFor(new Date().toISOString().slice(0, 10));
    const today = new Date().toISOString().slice(0, 10);
    const period = { key: "t", label: "test", start: fy.startDate, end: today };
    const pos = computeVatPosition(period);
    assert.equal(pos.utgaende, 2_500);
    assert.equal(pos.ingaende, 250);
    assert.equal(pos.attBetala, 2_250);
    const box05 = pos.boxes.find((b) => b.code === "05")!;
    assert.equal(box05.amount, 10_000);
    const box49 = pos.boxes.find((b) => b.code === "49")!;
    assert.equal(box49.amount, 2_250);
  });

  it("deklaration för om momsen till 2650 och låser perioden", () => {
    // Bokför i första kvartalet i fjol så att perioden är avslutad.
    postVerification({
      date: `${LAST_YEAR}-02-10T12:00:00Z`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 12_500 },
        { account: 3001, credit: 10_000 },
        { account: 2611, credit: 2_500 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const report = generateVatReport(`${LAST_YEAR}-K1`);
    assert.equal(report.attBetala, 2_500);

    markVatReportDeclared(report.id, "anvandare");
    assert.equal(report.status, "deklarerad");
    // 2611 är nollställt för perioden, skulden ligger på 2650.
    assert.equal(accountBalance(2611, `${LAST_YEAR}-03-31`), 0);
    assert.equal(accountBalance(2650, `${LAST_YEAR}-03-31`), -2_500);
    // Perioden är låst.
    assert.ok(isDateLocked(`${LAST_YEAR}-02-10`));
    assert.throws(() =>
      postVerification({
        date: `${LAST_YEAR}-02-15T12:00:00Z`,
        description: "Bakdaterad",
        entries: [
          { account: 1930, debit: 1 },
          { account: 3001, credit: 1 },
        ],
        source: { type: "manuell" },
        createdBy: "anvandare",
      })
    );
    // Momsperioderna rapporterar rätt status.
    const periods = vatPeriods(LAST_YEAR);
    assert.equal(periods[0].state, "deklarerad");
  });
});

/* ------------------------------------ Periodlås --------------------------------- */

describe("Periodlås", () => {
  beforeEach(() => reset());

  it("blockerar bakdaterade poster och flyttar händelser till öppen dag", () => {
    lockPeriod(`${THIS_YEAR}-01-31`, "anvandare");
    assert.ok(isDateLocked(`${THIS_YEAR}-01-15`));
    assert.throws(
      () =>
        postVerification({
          date: `${THIS_YEAR}-01-15T12:00:00Z`,
          description: "Bakdaterad",
          entries: [
            { account: 1930, debit: 100 },
            { account: 3001, credit: 100 },
          ],
          source: { type: "manuell" },
          createdBy: "anvandare",
        }),
      (e: unknown) => e instanceof PostingError && e.code === "period_last"
    );
    const clamped = clampToOpenDate(`${THIS_YEAR}-01-15`);
    assert.deepEqual(clamped, { date: `${THIS_YEAR}-02-01`, adjusted: true, originalDate: `${THIS_YEAR}-01-15` });
    // Låset kan aldrig backas.
    lockPeriod(`${THIS_YEAR}-01-01`, "anvandare");
    assert.equal(db().accounting.lockedThrough, `${THIS_YEAR}-01-31`);
  });
});

/* ------------------------------ Inventarier & avskrivning ----------------------- */

describe("Inventarier och avskrivningar", () => {
  beforeEach(() => reset());

  it("registrering bokför tillgången och avskrivningen är deterministisk", () => {
    const expense = unansweredExpense({
      id: "exp-mac",
      supplier: "Webhallen",
      description: "MacBook Pro",
      amount: 43_750,
      vatAmount: 8_750,
      date: `${THIS_YEAR}-03-05T12:00:00Z`,
    });
    assert.ok(expense.amount - expense.vatAmount >= INVENTARIE_GRANS);

    const asset = registerAssetFromExpense(expense.id, { usefulLifeYears: 5, by: "anvandare" });
    assert.equal(asset.acquisitionValue, 35_000);
    const ver = db().verifications.find((v) => v.id === asset.acquisitionVerificationId)!;
    assert.ok(balanced(ver.entries));
    assert.equal(ver.entries.find((e) => e.account === 1220)!.debit, 35_000);
    assert.equal(accountBalance(1220), 35_000);

    // Mars–december = 10 månader av 60: 35 000 × 10/60 = 5 833 kr.
    const fy = fiscalYears().find((f) => f.label === String(THIS_YEAR))!;
    assert.equal(depreciationForYear(asset, fy), Math.round((35_000 * 10) / 60));

    const { amount } = createDepreciationEntry(asset.id, fy.id, "anvandare");
    assert.equal(amount, 5_833);
    // Bokslutsverifikationen läggs på årets sista dag.
    assert.equal(accountBalance(7832, fy.endDate), 5_833);
    assert.equal(accountBalance(1229, fy.endDate), -5_833);
    assert.equal(bookValue(asset), 35_000 - 5_833);
    // Samma år skrivs inte av två gånger.
    assert.equal(createDepreciationEntry(asset.id, fy.id, "anvandare").amount, 0);
  });
});

/* ---------------------------------- Periodiseringar ----------------------------- */

describe("Periodiseringar", () => {
  beforeEach(() => reset());

  it("förutbetald kostnad flyttas över bokslutet och återförs i nya året", () => {
    // Årslicens sep i år → aug nästa år: 8 av 12 månader hör till nästa år.
    assert.equal(amountAfterYearEnd(12_000, `${THIS_YEAR}-09-01`, `${THIS_YEAR + 1}-08-31`, `${THIS_YEAR}-12-31`), 8_000);

    const fy = ensureFiscalYearFor(`${THIS_YEAR}-06-15`);
    const accrual = planAccrual({
      kind: "forutbetald_kostnad",
      description: "Adobe årslicens",
      totalAmount: 12_000,
      counterAccount: 5420,
      fromDate: `${THIS_YEAR}-09-01`,
      toDate: `${THIS_YEAR + 1}-08-31`,
      fiscalYearId: fy.id,
      by: "anvandare",
    });
    assert.equal(accrual.amount, 8_000);

    bookAccrual(accrual.id, "anvandare");
    assert.equal(accountBalance(1710, `${THIS_YEAR}-12-31`), 8_000);
    assert.equal(accountBalance(5420, `${THIS_YEAR}-12-31`), -8_000);

    reverseAccrualsInto(`${THIS_YEAR + 1}-01-01`, fy.id, "anvandare");
    assert.equal(accrual.status, "aterford");
    // Återföringen speglar bokslutsposten i det nya året.
    const rev = db().verifications.find((v) => v.id === accrual.reverseVerificationId)!;
    assert.equal(rev.entries.find((e) => e.account === 1710)!.credit, 8_000);
    assert.equal(rev.entries.find((e) => e.account === 5420)!.debit, 8_000);
    assert.ok(ledgerIntegrity().balanced);
  });
});

/* -------------------------------------- Bokslut --------------------------------- */

describe("Bokslut", () => {
  beforeEach(() => reset());

  function postInYear(year: number, revenue: number, cost: number) {
    postVerification({
      date: `${year}-05-10T12:00:00Z`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: Math.round(revenue * 1.25) },
        { account: 3001, credit: revenue },
        { account: 2611, credit: Math.round(revenue * 0.25) },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    if (cost > 0) {
      postVerification({
        date: `${year}-06-10T12:00:00Z`,
        description: "Kostnad",
        entries: [
          { account: 4010, debit: cost },
          { account: 1930, credit: cost },
        ],
        source: { type: "manuell" },
        createdBy: "anvandare",
      });
    }
  }

  function declareAllVat(year: number) {
    for (const p of vatPeriods(year)) {
      if (p.state === "att_deklarera" && (p.position.utgaende !== 0 || p.position.ingaende !== 0)) {
        const report = generateVatReport(p.period.key);
        markVatReportDeclared(report.id, "anvandare");
      }
    }
  }

  it("checklistan blockerar tills momsen är deklarerad och året har tagit slut", () => {
    postInYear(LAST_YEAR, 100_000, 20_000);
    const fy = fiscalYears().find((f) => f.label === String(LAST_YEAR))!;
    const items = bokslutChecklist(fy.id);
    assert.equal(items.find((c) => c.key === "aret_slut")!.ok, true);
    assert.equal(items.find((c) => c.key === "moms")!.ok, false);
    assert.throws(() => closeFiscalYear(fy.id, "anvandare"));

    // Innevarande år kan aldrig stängas (året pågår).
    postInYear(THIS_YEAR, 10_000, 0);
    const current = fiscalYears().find((f) => f.label === String(THIS_YEAR))!;
    assert.equal(bokslutChecklist(current.id).find((c) => c.key === "aret_slut")!.ok, false);
  });

  it("stängning bokför skatt + resultat, låser året och för UB → IB", () => {
    postInYear(LAST_YEAR, 100_000, 20_000);
    declareAllVat(LAST_YEAR);
    const fy = fiscalYears().find((f) => f.label === String(LAST_YEAR))!;

    const result = closeFiscalYear(fy.id, "anvandare");

    // Resultat: 100 000 − 20 000 = 80 000 före skatt; skatt 20,6 % avrundat.
    assert.equal(result.resultatForeSkatt, 80_000);
    assert.equal(result.skatt, Math.floor(80_000 * 0.206));
    assert.equal(result.aretsResultat, 80_000 - result.skatt);
    assert.equal(fy.status, "stangt");
    assert.ok(isDateLocked(`${LAST_YEAR}-12-31`));

    // Resultatkontona är nollade via 8999; vinsten står på 2099.
    assert.equal(accountBalance(2099, `${LAST_YEAR}-12-31`), -result.aretsResultat);
    assert.equal(accountBalance(2512, `${LAST_YEAR}-12-31`), -result.skatt);

    // Nya året: IB = UB, bara balanskonton, summan 0.
    const next = result.nextYear;
    assert.equal(next.label, String(THIS_YEAR));
    assert.equal(next.openingSource, "foregaende_ar");
    const ibSum = Object.values(next.openingBalances).reduce((s, n) => s + n, 0);
    assert.equal(ibSum, 0);
    assert.ok(Object.keys(next.openingBalances).every((a) => Number(a) < 3000));
    const ubBank = accountBalance(1930, `${LAST_YEAR}-12-31`);
    assert.equal(next.openingBalances["1930"], ubBank);

    // Stängt år tar inte emot nya poster – inte ens rättelser.
    assert.throws(
      () =>
        postVerification({
          date: `${LAST_YEAR}-06-15T12:00:00Z`,
          description: "Efterbokning",
          entries: [
            { account: 1930, debit: 1 },
            { account: 3001, credit: 1 },
          ],
          source: { type: "manuell" },
          createdBy: "anvandare",
        }),
      (e: unknown) => e instanceof PostingError && e.code === "rakenskapsar_stangt"
    );

    // Balansen går ihop efter stängningen.
    assert.ok(ledgerIntegrity().balanced);
    const br = balansrapport(`${LAST_YEAR}-12-31`);
    assert.equal(br.differens, 0);
  });

  it("bokslutsautomatiken bokför väntande avskrivningar och periodiseringar", () => {
    postInYear(LAST_YEAR, 100_000, 0);
    // Inventarie anskaffad i januari i fjol.
    const expense = unansweredExpense({
      id: "exp-maskin",
      supplier: "Maskin AB",
      description: "Planhyvel",
      amount: 50_000,
      vatAmount: 10_000,
      date: `${LAST_YEAR}-01-15T12:00:00Z`,
    });
    const asset = registerAssetFromExpense(expense.id, { usefulLifeYears: 5, by: "anvandare" });
    const fy = fiscalYears().find((f) => f.label === String(LAST_YEAR))!;
    const res = runBokslutAutomation(fy.id, "anvandare");
    assert.equal(res.depreciations, 1);
    // Helt år: 40 000 / 5 = 8 000.
    assert.equal(accountBalance(7832, `${LAST_YEAR}-12-31`), 8_000);
    assert.equal(asset.depreciations.length, 1);
  });

  it("skatteberäkningen skiljer bokfört och skattemässigt resultat", () => {
    postInYear(LAST_YEAR, 100_000, 0);
    // Ej avdragsgill representation.
    postVerification({
      date: `${LAST_YEAR}-07-01T12:00:00Z`,
      description: "Representation",
      entries: [
        { account: 6072, debit: 3_000 },
        { account: 1930, credit: 3_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const fy = fiscalYears().find((f) => f.label === String(LAST_YEAR))!;
    const tax = computeTaxCalculation(fy);
    assert.equal(tax.redovisningsresultat, 97_000);
    assert.equal(tax.skattemassigtResultat, 100_000);
    assert.equal(tax.beskattningsbartResultat, 100_000);
    assert.equal(tax.beraknadSkatt, Math.floor(100_000 * 0.206));
  });
});

/* ---------------------------------- Bankavstämning ------------------------------ */

describe("Bankavstämning", () => {
  beforeEach(() => reset());

  it("ohanterade transaktioner förklarar skillnaden mellan bank och 1930", () => {
    db().bankAccounts[0].balance = 10_000;
    db().bankTransactions.push({
      id: "tx-1",
      accountId: "bank-1",
      date: new Date().toISOString(),
      amount: 10_000,
      counterpart: "Okänd",
      description: "Insättning",
      status: "ny",
    });
    const recon = bankReconciliation();
    assert.equal(recon.bankBalance, 10_000);
    assert.equal(recon.ledgerBalance, 0);
    assert.equal(recon.difference, 10_000);
    assert.equal(recon.unhandledSum, 10_000);
    assert.equal(recon.unexplained, 0);
    assert.equal(recon.ok, false);
  });
});

/* -------------------------------------- SIE ------------------------------------- */

describe("SIE-export", () => {
  beforeEach(() => reset());

  it("innehåller kontoplan, IB/UB/RES och verifikationer med balanserade transaktioner", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const sie = generateSie();
    assert.match(sie, /#FLAGGA 0/);
    assert.match(sie, /#SIETYP 4/);
    assert.match(sie, /#ORGNR 559123-4567/);
    assert.match(sie, /#KONTO 1510 "Kundfordringar"/);
    assert.match(sie, /#RES 0 3001 -10000\.00/);
    assert.match(sie, /#UB 0 1510 12500\.00/);
    assert.match(sie, /#VER "A" 1 \d{8}/);
    // Transaktionsraderna i en verifikation summerar till noll.
    const trans = [...sie.matchAll(/#TRANS \d+ \{\} (-?\d+)\.00/g)].map((m) => Number(m[1]));
    assert.equal(trans.reduce((s, n) => s + n, 0), 0);
    // PC8-kodning: å/ä/ö blir CP437-byte, aldrig "?".
    const bytes = encodeSieToPc8('#KONTO 1510 "Kundfordringar åäö"');
    assert.ok(bytes.includes(0x86) && bytes.includes(0x84) && bytes.includes(0x94));
    assert.ok(!new TextDecoder("ascii").decode(bytes).includes("?"));
  });
});
