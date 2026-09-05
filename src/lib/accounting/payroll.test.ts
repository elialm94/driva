process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { birthDateFromPersonnummer, ageAtStartOfYear } from "../personnummer";
import { accountBalance } from "./ledger";
import { getVerification } from "./engine";
import {
  agiDueDate,
  contributionRateFor,
  currentEmployee,
  employerDeclarationFor,
  employerDeclarationsAwaitingFiling,
  endEmployment,
  generateEmployerDeclaration,
  markEmployerDeclarationDeclared,
  payrollMonthsAwaitingRun,
  payrollRuns,
  payrollTotals,
  payslip,
  preliminaryTax,
  reversePayrollRun,
  runPayroll,
  saveEmployee,
  taxLookupStale,
  ARBETSGIVARAVGIFT,
  FULL_CONTRIBUTION_PERCENT,
  LON_FORETAGSLEDARE,
  LON_TJANSTEMAN,
  PENSIONER_CONTRIBUTION_PERCENT,
  PERSONALSKATT,
  SOCIALA_AVGIFTER,
  type EmployeeInput,
} from "./payroll";
import { SKATTEKONTO } from "./tax-account";

/**
 * Lönen är produktens första månatliga myndighetsskyldighet. Testerna håller
 * fast fyra saker: arbetsgivaravgiften följer åldern vid årets ingång, en månad
 * kan bara köras en gång, deklarationen fryser exakt det som är bokfört, och en
 * lämnad deklaration låser månaden.
 */

const YEAR = 2026;

function reset() {
  replaceDb(emptyTestDb());
  db().fiscalYears.push({
    id: "fy",
    label: String(YEAR),
    startDate: `${YEAR}-01-01`,
    endDate: `${YEAR}-12-31`,
    status: "oppet",
    openingBalances: {},
    openingSource: "migrering",
  });
}

function input(over: Partial<EmployeeInput> = {}): EmployeeInput {
  return {
    name: "Anna Ek",
    personnummer: "19850612-1234",
    role: "foretagsledare",
    monthlySalary: 40_000,
    taxBasis: { kind: "procent", percent: 30 },
    startDate: `${YEAR}-01-01`,
    ...over,
  };
}

function hire(over: Partial<EmployeeInput> = {}) {
  return saveEmployee(input(over), "anvandare");
}

/** Bokförd rörelse på ett konto under en månad. Kredit är positiv skuld. */
function liability(account: number, month: string): number {
  let sum = 0;
  for (const v of db().verifications) {
    if (v.date.slice(0, 7) !== month) continue;
    for (const e of v.entries) if (e.account === account) sum += e.credit - e.debit;
  }
  return sum;
}

describe("födelsedatum ur personnummer", () => {
  it("tolkar tolv siffror rakt av", () => {
    assert.equal(birthDateFromPersonnummer("19850612-1234"), "1985-06-12");
  });

  it("väljer sekel så att personen lever", () => {
    assert.equal(birthDateFromPersonnummer("850612-1234", "2026-09-05"), "1985-06-12");
    assert.equal(birthDateFromPersonnummer("100612-1234", "2026-09-05"), "2010-06-12");
  });

  it("hanterar samordningsnummer där dagen är plus 60", () => {
    assert.equal(birthDateFromPersonnummer("19850672-1234"), "1985-06-12");
  });

  it("avvisar det som inte är ett personnummer", () => {
    assert.equal(birthDateFromPersonnummer("hej"), null);
    assert.equal(birthDateFromPersonnummer("19851312-1234"), null);
  });

  it("räknar åldern vid årets ingång, inte på födelsedagen", () => {
    // Fyller 66 i mars 2026 – vid ingången av året är hen 65.
    assert.equal(ageAtStartOfYear("1960-03-01", 2026), 65);
    assert.equal(ageAtStartOfYear("1960-01-01", 2026), 66);
  });
});

describe("arbetsgivaravgift efter ålder", () => {
  it("full avgift i arbetsför ålder", () => {
    const rate = contributionRateFor("1985-06-12", YEAR);
    assert.equal(rate.percent, FULL_CONTRIBUTION_PERCENT);
  });

  it("bara ålderspensionsavgift från det år den anställde fyllt 66 vid årets ingång", () => {
    assert.equal(contributionRateFor("1959-06-12", YEAR).percent, PENSIONER_CONTRIBUTION_PERCENT);
    assert.equal(contributionRateFor("1960-06-12", YEAR).percent, FULL_CONTRIBUTION_PERCENT);
  });

  it("inga avgifter för den som är född före 1938", () => {
    assert.equal(contributionRateFor("1937-06-12", YEAR).percent, 0);
  });

  it("regeln följer med som klartext, så lönespecifikationen kan visa varför", () => {
    assert.match(contributionRateFor("1985-06-12", YEAR).reason, /full avgift/);
  });
});

describe("preliminärskatt", () => {
  it("fast procent räknas på bruttolönen", () => {
    assert.equal(preliminaryTax(40_000, { kind: "procent", percent: 30 }), 12_000);
  });

  it("tabell använder det uppslagna beloppet – Driva hittar inte på skatt", () => {
    const basis = { kind: "tabell" as const, table: 33, monthlyDeduction: 9_412, salaryAtLookup: 40_000 };
    assert.equal(preliminaryTax(40_000, basis), 9_412);
  });

  it("uppslaget flaggas när lönen inte längre är den som slogs upp", () => {
    const basis = { kind: "tabell" as const, table: 33, monthlyDeduction: 9_412, salaryAtLookup: 40_000 };
    assert.equal(taxLookupStale(basis, 40_000), false);
    assert.equal(taxLookupStale(basis, 45_000), true);
  });

  it("avdraget kan aldrig göra nettot negativt", () => {
    assert.equal(preliminaryTax(10_000, { kind: "procent", percent: 150 }), 10_000);
  });
});

describe("anställd", () => {
  beforeEach(reset);

  it("läggs upp och hittas som nuvarande anställd", () => {
    const e = hire();
    assert.equal(currentEmployee()?.id, e.id);
    assert.equal(e.status, "anstalld");
  });

  it("avvisar en andra anställd – V1 är en anställd", () => {
    hire();
    assert.throws(() => hire({ name: "Bo Ek", personnummer: "19900101-1111" }), /redan upplagd/);
  });

  it("avvisar ett personnummer som inte går att tolka", () => {
    assert.throws(() => hire({ personnummer: "12345" }), /personnummret/i);
  });

  it("avvisar en tabell utanför Skatteverkets nummerserie", () => {
    assert.throws(
      () => hire({ taxBasis: { kind: "tabell", table: 12, monthlyDeduction: 9_000, salaryAtLookup: 40_000 } }),
      /Skattetabellen/
    );
  });

  it("avvisar ett tabellavdrag som är större än lönen", () => {
    assert.throws(
      () => hire({ taxBasis: { kind: "tabell", table: 33, monthlyDeduction: 50_000, salaryAtLookup: 40_000 } }),
      /större än månadslönen/
    );
  });

  it("avslutad anställning öppnar för en ny", () => {
    const e = hire();
    endEmployment(e.id, `${YEAR}-03-31`, "anvandare");
    assert.equal(currentEmployee(), undefined);
    const next = hire({ name: "Bo Ek", personnummer: "19900101-1111", startDate: `${YEAR}-04-01` });
    assert.equal(next.name, "Bo Ek");
  });
});

describe("lönekörning", () => {
  beforeEach(reset);

  it("bokför brutto, avgifter, skatt och netto i en balanserad verifikation", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.equal(run.gross, 40_000);
    assert.equal(run.tax, 12_000);
    assert.equal(run.net, 28_000);
    assert.equal(run.employerContribution, Math.round(40_000 * 0.3142));

    const ver = getVerification(run.verificationId)!;
    const debit = ver.entries.reduce((s, e) => s + e.debit, 0);
    const credit = ver.entries.reduce((s, e) => s + e.credit, 0);
    assert.equal(debit, credit);
    assert.equal(run.gross, run.tax + run.net);
    assert.equal(accountBalance(LON_FORETAGSLEDARE, `${YEAR}-12-31`), 40_000);
    assert.equal(accountBalance(SOCIALA_AVGIFTER, `${YEAR}-12-31`), run.employerContribution);
  });

  it("ägarens lön hamnar på 7220, en tjänstemans på 7210", () => {
    hire({ role: "tjansteman" });
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.equal(run.salaryAccount, LON_TJANSTEMAN);
  });

  it("samma månad två gånger ger samma körning – lönen dubbleras inte", () => {
    hire();
    const first = runPayroll({ month: `${YEAR}-02` }, "anvandare");
    const second = runPayroll({ month: `${YEAR}-02` }, "anvandare");
    assert.equal(second.id, first.id);
    assert.equal(payrollRuns().length, 1);
  });

  it("skatt och avgifter står som skuld till Skatteverket efter lönen", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.equal(liability(PERSONALSKATT, `${YEAR}-01`), run.tax);
    assert.equal(liability(ARBETSGIVARAVGIFT, `${YEAR}-01`), run.employerContribution);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-01-31`), 0);
  });

  it("pensionärslön får den lägre avgiften", () => {
    hire({ personnummer: "19550612-1234" });
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.equal(run.contributionPercent, PENSIONER_CONTRIBUTION_PERCENT);
    assert.equal(run.employerContribution, Math.round(40_000 * 0.1021));
  });

  it("lön före anställningens början avvisas", () => {
    hire({ startDate: `${YEAR}-03-01` });
    assert.throws(() => runPayroll({ month: `${YEAR}-01` }, "anvandare"), /Anställningen började/);
  });

  it("månader utan bokförd lön ligger kvar som att göra", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const waiting = payrollMonthsAwaitingRun(`${YEAR}-03-26`);
    assert.deepEqual(waiting, [`${YEAR}-02`, `${YEAR}-03`]);
  });

  it("innevarande månad väntar först när lönedagen passerat", () => {
    hire();
    assert.deepEqual(payrollMonthsAwaitingRun(`${YEAR}-01-24`), []);
    assert.deepEqual(payrollMonthsAwaitingRun(`${YEAR}-01-25`), [`${YEAR}-01`]);
  });

  it("en felaktig lön återförs med rättelse och månaden kan köras om", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const reversal = reversePayrollRun(run.id, "fel månadslön", "anvandare");
    assert.equal(payrollRuns().length, 0);
    assert.equal(accountBalance(LON_FORETAGSLEDARE, `${YEAR}-12-31`), 0);
    assert.equal(getVerification(run.verificationId)?.correctedByVerificationId, reversal.id);

    saveEmployee({ ...input({ monthlySalary: 45_000 }), id: currentEmployee()!.id }, "anvandare");
    const redo = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.equal(redo.gross, 45_000);
  });
});

describe("lönespecifikation", () => {
  beforeEach(reset);

  it("visar månadens belopp och det ackumulerade för året", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const run = runPayroll({ month: `${YEAR}-02` }, "anvandare");
    const slip = payslip(run.id);
    assert.equal(slip.run.net, 28_000);
    assert.equal(slip.yearToDate.gross, 80_000);
    assert.equal(slip.yearToDate.tax, 24_000);
    assert.equal(slip.yearToDate.net, 56_000);
    assert.equal(slip.monthLabel, `februari ${YEAR}`);
    assert.equal(slip.taxLabel, "30 %");
  });
});

describe("arbetsgivardeklaration", () => {
  beforeEach(reset);

  it("förfallodagen är den 12:e månaden efter, den 17:e i januari och augusti", () => {
    assert.equal(agiDueDate(`${YEAR}-03`), `${YEAR}-04-12`);
    assert.equal(agiDueDate(`${YEAR}-07`), `${YEAR}-08-17`);
    assert.equal(agiDueDate(`${YEAR}-12`), `${YEAR + 1}-01-17`);
  });

  it("utkastet speglar de bokförda lönekörningarna", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const declaration = employerDeclarationFor(`${YEAR}-01`)!;
    assert.equal(declaration.status, "utkast");
    assert.equal(declaration.gross, run.gross);
    assert.equal(declaration.tax, run.tax);
    assert.equal(declaration.employerContribution, run.employerContribution);
    assert.equal(declaration.attBetala, run.tax + run.employerContribution);
    assert.equal(declaration.rows.length, 1);
    assert.equal(declaration.rows[0].name, "Anna Ek");
  });

  it("deklarationen förs till skattekontot och nollställer skuldkontona", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const declaration = markEmployerDeclarationDeclared(employerDeclarationFor(`${YEAR}-01`)!.id, "anvandare");
    assert.equal(declaration.status, "deklarerad");
    assert.ok(declaration.taxAccountVerificationId);
    assert.equal(liability(PERSONALSKATT, `${YEAR}-01`), 0);
    assert.equal(liability(ARBETSGIVARAVGIFT, `${YEAR}-01`), 0);
    assert.equal(
      accountBalance(SKATTEKONTO, `${YEAR}-01-31`),
      -(run.tax + run.employerContribution)
    );
  });

  it("deklarationen låser månaden", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    markEmployerDeclarationDeclared(employerDeclarationFor(`${YEAR}-01`)!.id, "anvandare");
    assert.equal(db().accounting.lockedThrough, `${YEAR}-01-31`);
  });

  it("en lämnad deklaration går inte att ändra eller lämna igen", () => {
    hire();
    const run = runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const id = employerDeclarationFor(`${YEAR}-01`)!.id;
    markEmployerDeclarationDeclared(id, "anvandare");
    const again = markEmployerDeclarationDeclared(id, "anvandare");
    assert.equal(again.declaredAt, employerDeclarationFor(`${YEAR}-01`)!.declaredAt);
    assert.throws(() => reversePayrollRun(run.id, "för sent", "anvandare"), /är lämnad/);
  });

  it("en månad som pågår kan inte deklareras", () => {
    hire();
    const month = new Date().toISOString().slice(0, 7);
    runPayroll({ month }, "anvandare");
    const declaration = employerDeclarationFor(month)!;
    assert.throws(() => markEmployerDeclarationDeclared(declaration.id, "anvandare"), /pågår fortfarande/);
  });

  it("månaderna deklareras i ordning", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    runPayroll({ month: `${YEAR}-02` }, "anvandare");
    assert.throws(
      () => markEmployerDeclarationDeclared(employerDeclarationFor(`${YEAR}-02`)!.id, "anvandare"),
      /i ordning/
    );
    markEmployerDeclarationDeclared(employerDeclarationFor(`${YEAR}-01`)!.id, "anvandare");
    const second = markEmployerDeclarationDeclared(employerDeclarationFor(`${YEAR}-02`)!.id, "anvandare");
    assert.equal(second.status, "deklarerad");
  });

  it("en månad utan lön deklareras som nollredovisning utan bokföring", () => {
    hire();
    const declaration = generateEmployerDeclaration(`${YEAR}-01`, "anvandare");
    assert.equal(declaration.attBetala, 0);
    const declared = markEmployerDeclarationDeclared(declaration.id, "anvandare");
    assert.equal(declared.status, "deklarerad");
    assert.equal(declared.taxAccountVerificationId, undefined);
    assert.equal(db().verifications.length, 0);
    // Nollredovisningen är lämnad – lön för månaden får inte tillkomma efteråt.
    assert.throws(() => runPayroll({ month: `${YEAR}-01` }, "anvandare"), /redan lämnad/);
  });

  it("avslutade månader med lön ligger kvar som att lämna", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    const waiting = employerDeclarationsAwaitingFiling(`${YEAR}-02-13`);
    assert.deepEqual(waiting.map((d) => d.month), [`${YEAR}-01`]);
  });

  it("lönesummor per period är underlag för bokslutet", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    runPayroll({ month: `${YEAR}-02` }, "anvandare");
    const totals = payrollTotals(`${YEAR}-01-01`, `${YEAR}-12-31`);
    assert.equal(totals.gross, 80_000);
    assert.equal(totals.months, 2);
  });
});
