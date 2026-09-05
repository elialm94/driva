process.env.DRIVA_TEST = "1";

/**
 * Finansiella invarianter – egenskapsbaserade tester + hela demoseedet.
 *
 * Egenskaper (slumpade indata, seedad PRNG – deterministiskt återspelbara):
 *   1. docTotals-ekvationen håller för alla giltiga radkombinationer:
 *      subtotal + moms = total, toPay = total − avdrag, allt i hela kronor.
 *   2. ROT/RUT-avdraget respekterar andel och tak (ROT 30 %/50 000,
 *      RUT 50 %/75 000) och är aldrig negativt.
 *   3. Varje kontobyggare i bas.ts producerar balanserade verifikationer
 *      (sum(debet) === sum(kredit)) för alla giltiga belopp.
 *
 * Seedet (buildSeed – hela demoföretaget):
 *   4. Alla verifikationer balanserar; saldobalansen balanserar.
 *   5. Fakturaekvationen håller för varje faktura.
 *   6. Kvar att fakturera ≥ 0 för alla uppdrag.
 *   7. Kundens utestående = summan av öppna fordringar.
 *   8. Bankens saldo = huvudbokens 1930; avstämningen är förklarad.
 *   9. Momsrapporten stämmer med en oberoende omräkning ur huvudboken.
 *  10. Skattekontot flyttar momsskulden mellan konton utan att ändra summan.
 *  11. Lönen fördelar bruttolönen i netto och skatt utan att tappa en krona,
 *      och deklarationen flyttar skulden till skattekontot oförändrad.
 *  12. SIE-exporten stämmer med huvudboken (IB + rörelser = UB, RES,
 *      varje #VER balanserar).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { buildSeed } from "./seed";
import { docTotals, ROT_ANDEL, RUT_ANDEL, ROT_TAK, RUT_TAK, taxReductionCap } from "./calc";
import { isTaxReductionEligible, lineTypeOf } from "./economic-line-type";
import type { DocLine, RotRut, VerificationEntry } from "./types";
import {
  entriesCredit,
  entriesCustomerRefund,
  entriesExpense,
  entriesInvoicePaymentReceived,
  entriesInvoiceSent,
  entriesTaxReductionPayout,
  entriesDeniedReductionInvoice,
  entriesSupplierInvoicePaid,
  EXPENSE_CATEGORIES,
} from "./bas";
import { accountBalance, isResultAccount, ledgerIntegrity, saldobalans } from "./accounting/ledger";
import { bankReconciliation } from "./accounting/reconciliation";
import { computeVatPosition, generateVatReport, markVatReportDeclared, vatPeriods } from "./accounting/vat";
import { verificationLabel } from "./accounting/engine";
import {
  bookVatOnTaxAccount,
  taxAccountLedger,
  MOMS_REDOVISNING,
  SKATTEKONTO,
} from "./accounting/tax-account";
import {
  employerDeclarationFor,
  markEmployerDeclarationDeclared,
  runPayroll,
  saveEmployee,
  ARBETSGIVARAVGIFT,
  PERSONALSKATT,
  SOCIALA_AVGIFTER,
} from "./accounting/payroll";
import { quartersOf, ensureFiscalYearFor } from "./accounting/fiscal";
import { bokforingsdatum } from "./accounting/dates";
import { generateSie } from "./accounting/sie";
import { customerSummary, invoiceOutstanding, invoiceTotals, isOpenReceivable } from "./services/data";
import { remainingToInvoiceForJob } from "./services/attention";

/* ----------------------------- Seedad PRNG ----------------------------- */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const VAT_RATES = [0, 6, 12, 25] as const;
const KINDS = ["arbete", "material", "resor", "ovrigt"] as const;

function randomLine(rnd: () => number, i: number): DocLine {
  const qty = Math.max(0.25, Math.round(rnd() * 160) / 4); // 0,25–40 i steg om 0,25
  return {
    id: `l-${i}`,
    kind: KINDS[Math.floor(rnd() * KINDS.length)],
    description: "Testrad",
    qty,
    unit: "st",
    unitPrice: Math.max(1, Math.floor(rnd() * 100_000)),
    vatRate: VAT_RATES[Math.floor(rnd() * VAT_RATES.length)],
  };
}

function randomLines(rnd: () => number): DocLine[] {
  const n = 1 + Math.floor(rnd() * 6);
  return Array.from({ length: n }, (_, i) => randomLine(rnd, i));
}

function assertBalanced(entries: VerificationEntry[], label: string): void {
  const debit = entries.reduce((s, e) => s + e.debit, 0);
  const credit = entries.reduce((s, e) => s + e.credit, 0);
  assert.equal(debit, credit, `${label}: debet ${debit} ≠ kredit ${credit}`);
  for (const e of entries) {
    assert.ok(Number.isInteger(e.debit) && Number.isInteger(e.credit), `${label}: örebelopp i bokföringen`);
    assert.ok(e.debit >= 0 && e.credit >= 0, `${label}: negativa belopp i bokföringen`);
  }
}

/* ------------------------- 1–2: docTotals-egenskaper ------------------------ */

describe("Egenskap: docTotals-ekvationen håller för slumpade rader", () => {
  it("subtotal + moms = total, toPay = total − avdrag, hela kronor (500 fall)", () => {
    const rnd = mulberry32(42);
    for (let run = 0; run < 500; run++) {
      const lines = randomLines(rnd);
      const rotChoice = rnd();
      const rot: RotRut | null = rotChoice < 0.4 ? null : { type: rotChoice < 0.7 ? "rot" : "rut" };
      const t = docTotals(lines, rot);

      for (const v of [t.subtotal, t.vat, t.total, t.deduction, t.toPay]) {
        assert.ok(Number.isInteger(v), `heltalskronor: fick ${v}`);
      }
      assert.equal(t.subtotal + t.vat, t.total, "subtotal + moms = total");
      assert.equal(t.toPay, t.total - t.deduction, "toPay = total − avdrag");
      assert.ok(t.deduction >= 0, "avdraget är aldrig negativt");
      assert.ok(t.toPay >= 0, "toPay är aldrig negativt");

      if (rot) {
        const cap = taxReductionCap(rot.type);
        const andel = rot.type === "rot" ? ROT_ANDEL : RUT_ANDEL;
        assert.ok(t.deduction <= cap, `avdrag ${t.deduction} över taket ${cap}`);
        // Avdraget är aldrig större än andelen av arbetskostnaden inkl. moms (+1 kr avrundning).
        const laborInclVat = lines
          .filter((l) => isTaxReductionEligible(lineTypeOf(l), rot.type))
          .reduce((s, l) => s + Math.round(l.qty * l.unitPrice) * (1 + l.vatRate / 100), 0);
        assert.ok(
          t.deduction <= Math.round(laborInclVat * andel) + 1,
          `avdrag ${t.deduction} > ${andel * 100} % av arbete ${Math.round(laborInclVat)}`
        );
      } else {
        assert.equal(t.deduction, 0, "utan ROT/RUT finns inget avdrag");
      }
    }
  });

  it("taken är ROT 50 000 och RUT 75 000", () => {
    assert.equal(ROT_TAK, 50_000);
    assert.equal(RUT_TAK, 75_000);
    assert.equal(taxReductionCap("rot"), ROT_TAK);
    assert.equal(taxReductionCap("rut"), RUT_TAK);
  });
});

/* ------------------------ 3: bas-byggarna balanserar ------------------------ */

describe("Egenskap: alla kontobyggare balanserar (sum debet = sum kredit)", () => {
  it("fakturering, kredit, betalning, återbetalning, ROT-utbetalning, utgift (300 fall)", () => {
    const rnd = mulberry32(1337);
    for (let run = 0; run < 300; run++) {
      const lines = randomLines(rnd);
      const rot: RotRut | null = rnd() < 0.5 ? null : { type: rnd() < 0.5 ? "rot" : "rut" };
      assertBalanced(entriesInvoiceSent(lines, rot), "entriesInvoiceSent");
      assertBalanced(entriesCredit(lines, rot), "entriesCredit");
      // Omvänd byggmoms flyttar omsättningen till ett annat konto men får
      // aldrig rubba balansen.
      const byggLines = lines.map((l) => ({ ...l, vatRate: 0 as const }));
      assertBalanced(entriesInvoiceSent(byggLines, rot, { reverseCharge: true }), "entriesInvoiceSent byggmoms");
      assertBalanced(entriesCredit(byggLines, rot, { reverseCharge: true }), "entriesCredit byggmoms");

      const outstanding = 1 + Math.floor(rnd() * 100_000);
      // Betalningsscenarier: exakt, öresdiff ±1, delbetalning, överbetalning.
      const scenarios = [
        { bankAmount: outstanding, settleReceivable: outstanding, oresDiff: 0, excessToCustomerCredit: 0 },
        { bankAmount: outstanding - 1, settleReceivable: outstanding, oresDiff: 1, excessToCustomerCredit: 0 },
        { bankAmount: outstanding + 1, settleReceivable: outstanding, oresDiff: -1, excessToCustomerCredit: 0 },
        {
          bankAmount: Math.max(1, Math.floor(outstanding / 2)),
          settleReceivable: Math.max(1, Math.floor(outstanding / 2)),
          oresDiff: 0,
          excessToCustomerCredit: 0,
        },
        {
          bankAmount: outstanding + 500,
          settleReceivable: outstanding,
          oresDiff: 0,
          excessToCustomerCredit: 500,
        },
      ];
      for (const s of scenarios) assertBalanced(entriesInvoicePaymentReceived(s), "entriesInvoicePaymentReceived");

      const refund = 1 + Math.floor(rnd() * 50_000);
      const fromOverpayment = Math.floor(rnd() * refund);
      assertBalanced(
        entriesCustomerRefund({ fromOverpayment, fromCredit: refund - fromOverpayment }),
        "entriesCustomerRefund"
      );
      assertBalanced(entriesTaxReductionPayout(1 + Math.floor(rnd() * 50_000)), "entriesTaxReductionPayout");
      assertBalanced(entriesDeniedReductionInvoice(1 + Math.floor(rnd() * 10_000)), "entriesDeniedReductionInvoice");
      assertBalanced(entriesSupplierInvoicePaid(1 + Math.floor(rnd() * 10_000)), "entriesSupplierInvoicePaid");

      const cat = EXPENSE_CATEGORIES[Math.floor(rnd() * EXPENSE_CATEGORIES.length)];
      const gross = 2 + Math.floor(rnd() * 20_000);
      const vat = Math.min(gross - 1, Math.round((gross * 20) / 125));
      assertBalanced(entriesExpense(cat.key, gross, vat), "entriesExpense");
    }
  });
});

/* --------------------------- 4–10: seedade böcker --------------------------- */

describe("Demoseedet uppfyller alla finansiella invarianter", () => {
  function seeded() {
    replaceDb(buildSeed());
    return db();
  }

  it("alla verifikationer balanserar och saldobalansen är hel", () => {
    const data = seeded();
    const integrity = ledgerIntegrity();
    assert.ok(integrity.balanced, `obalanserat: ${integrity.unbalancedVerifications.join(", ")}`);
    for (const v of data.verifications) {
      assertBalanced(v.entries, `verifikation ${v.series}${v.number}`);
    }
    const sb = saldobalans();
    assert.equal(sb.sumDebit, sb.sumCredit, "saldobalansen balanserar inte");
  });

  it("fakturaekvationen håller för varje faktura", () => {
    const data = seeded();
    for (const inv of data.invoices) {
      const t = invoiceTotals(inv);
      assert.equal(t.subtotal + t.vat, t.total, `#${inv.number ?? inv.id}: subtotal+moms ≠ total`);
      assert.equal(t.toPay, t.total - t.deduction, `#${inv.number ?? inv.id}: toPay ≠ total − avdrag`);
      assert.ok(invoiceOutstanding(inv) >= 0, `#${inv.number ?? inv.id}: negativ utestående fordran`);
    }
  });

  it("kvar att fakturera ≥ 0 för alla uppdrag", () => {
    const data = seeded();
    for (const job of data.jobs) {
      const remaining = remainingToInvoiceForJob(job.id);
      assert.ok(remaining >= 0, `uppdrag ${job.title}: kvar att fakturera ${remaining} < 0`);
    }
  });

  it("kundens utestående = summan av öppna fordringar", () => {
    const data = seeded();
    for (const customer of data.customers) {
      const expected = data.invoices
        .filter((i) => i.customerId === customer.id)
        .reduce((s, i) => s + invoiceOutstanding(i), 0);
      assert.equal(customerSummary(customer.id).unpaid, expected, `${customer.name}: utestående stämmer inte`);
    }
    // Sanity: öppna fordringar är just de som har utestående > 0.
    for (const inv of data.invoices) {
      if (isOpenReceivable(inv)) assert.ok(invoiceOutstanding(inv) > 0, `öppen fordran #${inv.number} utan belopp`);
    }
  });

  it("bankavstämningen är förklarad: bank − 1930 = exakt de obokförda transaktionerna", () => {
    const data = seeded();
    const rec = bankReconciliation();
    // Banken kan ligga före bokföringen (obokförda transaktioner) – men varje
    // krona av skillnaden ska förklaras av dem. Allt annat är en riktig avvikelse.
    assert.equal(rec.unexplained, 0, "oförklarad differens i bankavstämningen");
    assert.equal(rec.difference, rec.unhandledSum, "differensen förklaras inte av ohanterade transaktioner");
    // Bokförs allt obokfört skulle bank = 1930 exakt.
    const bank = data.bankAccounts.reduce((s, a) => s + a.balance, 0);
    assert.equal(bank - rec.unhandledSum, accountBalance(1930), "bank − obokfört ≠ 1930");
  });

  it("momspositionen stämmer med en oberoende omräkning ur huvudboken", () => {
    const data = seeded();
    const fy = ensureFiscalYearFor(bokforingsdatum(new Date().toISOString()));
    for (const period of quartersOf(fy)) {
      const pos = computeVatPosition(period);
      // Oberoende omräkning direkt ur verifikationsraderna.
      let utgaende = 0;
      let ingaende = 0;
      for (const v of data.verifications) {
        const d = bokforingsdatum(v.date);
        if (d < period.start || d > period.end) continue;
        for (const e of v.entries) {
          if (e.account === 2611 || e.account === 2621 || e.account === 2631) utgaende += e.credit - e.debit;
          if (e.account === 2641) ingaende += e.debit - e.credit;
        }
      }
      assert.equal(pos.utgaende, utgaende, `${period.label}: utgående moms`);
      assert.equal(pos.ingaende, ingaende, `${period.label}: ingående moms`);
      assert.equal(pos.attBetala, utgaende - ingaende, `${period.label}: att betala`);
    }
  });

  it("skattekontot flyttar skulden utan att skapa eller tappa pengar", () => {
    seeded();
    const period = vatPeriods().find((p) => p.state === "att_deklarera" && p.position.attBetala !== 0);
    assert.ok(period, "demoseedet har en period som väntar på deklaration");

    const report = generateVatReport(period.period.key);
    markVatReportDeclared(report.id, "anvandare");
    const before = accountBalance(MOMS_REDOVISNING) + accountBalance(SKATTEKONTO);
    const declared = db().vatReports.find((r) => r.id === report.id)!;

    bookVatOnTaxAccount(declared.id, "anvandare");

    // Skulden byter konto, aldrig storlek: summan av redovisningskontot och
    // skattekontot är densamma före och efter, och 2650 är nollställt.
    assert.equal(accountBalance(MOMS_REDOVISNING) + accountBalance(SKATTEKONTO), before, "summan ändras");
    assert.equal(accountBalance(MOMS_REDOVISNING), 0, "redovisningskontot nollställs inte");
    const ledger = taxAccountLedger();
    assert.equal(ledger.balance, accountBalance(SKATTEKONTO), "skattekontots huvudbok avviker");
    for (const v of db().verifications) {
      const debit = v.entries.reduce((s, e) => s + e.debit, 0);
      const credit = v.entries.reduce((s, e) => s + e.credit, 0);
      assert.equal(debit, credit, `${verificationLabel(v)} balanserar inte`);
    }
  });

  it("lönen fördelar bruttolönen utan att tappa en krona på vägen", () => {
    seeded();
    // Föregående månad: avslutad, så deklarationen får lämnas.
    const now = new Date();
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString().slice(0, 7);
    const employee = saveEmployee(
      {
        name: "Ägaren",
        personnummer: "19850612-1234",
        role: "foretagsledare",
        monthlySalary: 40_000,
        taxBasis: { kind: "procent", percent: 30 },
        startDate: `${month}-01`,
      },
      "anvandare"
    );
    const run = runPayroll({ employeeId: employee.id, month }, "anvandare");

    // Bruttolönen fördelas i tre delar och ingenting försvinner: den anställde
    // får nettot, Skatteverket får skatten.
    assert.equal(run.gross, run.tax + run.net, "brutto ≠ skatt + netto");

    const cost = accountBalance(run.salaryAccount) + accountBalance(SOCIALA_AVGIFTER);
    const debt = -(accountBalance(PERSONALSKATT) + accountBalance(ARBETSGIVARAVGIFT));
    assert.equal(cost, run.gross + run.employerContribution, "lönekostnaden avviker");
    assert.equal(debt, run.tax + run.employerContribution, "skulden till Skatteverket avviker");

    // Deklarationen flyttar skulden till skattekontot – samma summa, nytt konto.
    const before = accountBalance(PERSONALSKATT) + accountBalance(ARBETSGIVARAVGIFT) + accountBalance(SKATTEKONTO);
    markEmployerDeclarationDeclared(employerDeclarationFor(month)!.id, "anvandare");
    assert.equal(
      accountBalance(PERSONALSKATT) + accountBalance(ARBETSGIVARAVGIFT) + accountBalance(SKATTEKONTO),
      before,
      "summan ändras när lönen förs till skattekontot"
    );
    assert.equal(accountBalance(PERSONALSKATT), 0, "personalskatten nollställs inte");
    assert.equal(accountBalance(ARBETSGIVARAVGIFT), 0, "arbetsgivaravgiften nollställs inte");
    for (const v of db().verifications) {
      const debit = v.entries.reduce((s, e) => s + e.debit, 0);
      const credit = v.entries.reduce((s, e) => s + e.credit, 0);
      assert.equal(debit, credit, `${verificationLabel(v)} balanserar inte`);
    }
  });

  it("SIE-exporten stämmer med huvudboken (IB + rörelser = UB/RES, varje #VER balanserar)", () => {
    seeded();
    const sie = generateSie();
    const lines = sie.split("\r\n");

    const ib = new Map<number, number>();
    const ub = new Map<number, number>();
    const res = new Map<number, number>();
    const movements = new Map<number, number>();
    let inVer = false;
    let verSum = 0;
    let verCount = 0;

    const num = (s: string) => Math.round(Number(s));
    for (const line of lines) {
      if (line.startsWith("#IB 0 ")) {
        const [, , acct, amount] = line.split(" ");
        ib.set(Number(acct), num(amount));
      } else if (line.startsWith("#UB 0 ")) {
        const [, , acct, amount] = line.split(" ");
        ub.set(Number(acct), num(amount));
      } else if (line.startsWith("#RES 0 ")) {
        const [, , acct, amount] = line.split(" ");
        res.set(Number(acct), num(amount));
      } else if (line.startsWith("#VER ")) {
        inVer = true;
        verSum = 0;
        verCount++;
      } else if (line === "}") {
        if (inVer) assert.equal(verSum, 0, "en #VER balanserar inte i SIE-filen");
        inVer = false;
      } else if (line.startsWith("#TRANS ")) {
        const parts = line.split(" ");
        const acct = Number(parts[1]);
        const amount = num(parts[3]);
        verSum += amount;
        movements.set(acct, (movements.get(acct) ?? 0) + amount);
      }
    }

    assert.ok(verCount > 0, "SIE-filen saknar verifikationer");
    // Balanskonton: IB + rörelser = UB. Resultatkonton: RES = rörelser.
    const accounts = new Set([...ib.keys(), ...ub.keys(), ...res.keys(), ...movements.keys()]);
    for (const acct of accounts) {
      const mv = movements.get(acct) ?? 0;
      if (isResultAccount(acct) || acct === 8999) {
        assert.equal(res.get(acct) ?? 0, mv, `konto ${acct}: RES stämmer inte med rörelserna`);
      } else {
        assert.equal((ib.get(acct) ?? 0) + mv, ub.get(acct) ?? 0, `konto ${acct}: IB + rörelser ≠ UB`);
      }
    }
    // ...och mot huvudboken i domänen.
    const sb = saldobalans();
    for (const row of sb.rows) {
      if (isResultAccount(row.account) || row.account === 8999) {
        assert.equal(res.get(row.account) ?? 0, row.ub - row.ib, `konto ${row.account}: SIE ≠ saldobalans`);
      } else {
        assert.equal(ub.get(row.account) ?? 0, row.ub, `konto ${row.account}: SIE UB ≠ saldobalans UB`);
      }
    }
  });
});
