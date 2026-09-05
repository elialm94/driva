process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "./engine";
import { accountBalance } from "./ledger";
import { generateVatReport, markVatReportDeclared } from "./vat";
import {
  bookEmployerTaxesOnTaxAccount,
  bookFSkatt,
  bookTaxAccountDeposit,
  bookVatOnTaxAccount,
  fSkattMonthsAwaitingBooking,
  parseTaxAccountStatement,
  reconcileTaxAccount,
  taxAccountDepositCandidates,
  taxAccountLedger,
  vatReportsAwaitingTaxAccount,
  ARBETSGIVARAVGIFT,
  F_SKATT,
  MOMS_REDOVISNING,
  PERSONALSKATT,
  SKATTEKONTO,
} from "./tax-account";

/**
 * Skattekontot är bolagets bild av vad Skatteverket anser. Testerna håller fast
 * tre saker: saldot härleds alltid ur huvudboken, varje kontering är idempotent,
 * och avstämningen mot utdraget pekar ut vad som skiljer i stället för att bara
 * visa en differens.
 */

const YEAR = Number(new Date().toISOString().slice(0, 4));

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

/** Momsskuld i huvudboken: försäljning med utgående moms, inget avdrag. */
function bookSales(date: string, net: number, vat: number) {
  postVerification({
    date,
    description: "Försäljning",
    entries: [
      { account: 1930, debit: net + vat },
      { account: 3001, credit: net },
      { account: 2611, credit: vat },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

describe("skattekontots huvudbok", () => {
  beforeEach(reset);

  it("saldot är samma tal som huvudbokens konto 1630", () => {
    postVerification({
      date: `${YEAR}-03-10`,
      description: "Inbetalning",
      entries: [
        { account: SKATTEKONTO, debit: 25_000 },
        { account: 1930, credit: 25_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const ledger = taxAccountLedger(`${YEAR}-12-31`);
    assert.equal(ledger.balance, accountBalance(SKATTEKONTO, `${YEAR}-12-31`));
    assert.equal(ledger.balance, 25_000);
    assert.equal(ledger.rows.length, 1);
    assert.equal(ledger.rows[0].kind, "inbetalning");
  });

  it("löpande saldo utgår från räkenskapsårets ingående balans", () => {
    db().fiscalYears[0].openingBalances = { [String(SKATTEKONTO)]: 4_000 };
    postVerification({
      date: `${YEAR}-02-01`,
      description: "Inbetalning",
      entries: [
        { account: SKATTEKONTO, debit: 1_000 },
        { account: 1930, credit: 1_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const ledger = taxAccountLedger(`${YEAR}-12-31`);
    assert.equal(ledger.opening, 4_000);
    assert.equal(ledger.rows[0].balance, 5_000);
    assert.equal(ledger.balance, accountBalance(SKATTEKONTO, `${YEAR}-12-31`));
  });

  it("verifikationer utan 1630 hamnar inte på kontot", () => {
    bookSales(`${YEAR}-01-15`, 10_000, 2_500);
    assert.equal(taxAccountLedger(`${YEAR}-12-31`).rows.length, 0);
  });
});

describe("moms till skattekontot", () => {
  beforeEach(reset);

  function declaredVatReport() {
    bookSales(`${YEAR}-01-15`, 10_000, 2_500);
    const report = generateVatReport(`${YEAR}-K1`);
    markVatReportDeclared(report.id, "anvandare");
    return db().vatReports.find((r) => r.id === report.id)!;
  }

  it("skulden flyttas från redovisningskontot till skattekontot", () => {
    const report = declaredVatReport();
    assert.equal(accountBalance(MOMS_REDOVISNING, `${YEAR}-12-31`), -2_500);

    bookVatOnTaxAccount(report.id, "anvandare");
    assert.equal(accountBalance(MOMS_REDOVISNING, `${YEAR}-12-31`), 0);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -2_500);
    assert.equal(taxAccountLedger(`${YEAR}-12-31`).rows[0].kind, "moms");
  });

  it("samma rapport bokförs bara en gång", () => {
    const report = declaredVatReport();
    const first = bookVatOnTaxAccount(report.id, "anvandare");
    const second = bookVatOnTaxAccount(report.id, "anvandare");
    assert.equal(first.id, second.id);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -2_500);
  });

  it("odeklarerad moms kan inte föras till skattekontot", () => {
    bookSales(`${YEAR}-01-15`, 10_000, 2_500);
    const report = generateVatReport(`${YEAR}-K1`);
    assert.throws(() => bookVatOnTaxAccount(report.id, "anvandare"), /inte deklarerad/);
  });

  it("kontering går igenom periodlåset som deklarationen satte", () => {
    const report = declaredVatReport();
    assert.equal(db().accounting.lockedThrough, report.periodEnd);
    const ver = bookVatOnTaxAccount(report.id, "anvandare");
    assert.equal(ver.date.slice(0, 10), report.periodEnd);
  });

  it("kön visar deklarerade rapporter som inte är bokförda", () => {
    const report = declaredVatReport();
    assert.deepEqual(
      vatReportsAwaitingTaxAccount().map((r) => r.id),
      [report.id]
    );
    bookVatOnTaxAccount(report.id, "anvandare");
    assert.equal(vatReportsAwaitingTaxAccount().length, 0);
  });

  it("moms att få tillbaka tillgodoförs kontot", () => {
    postVerification({
      date: `${YEAR}-01-20`,
      description: "Inköp",
      entries: [
        { account: 5410, debit: 8_000 },
        { account: 2641, debit: 2_000 },
        { account: 1930, credit: 10_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const report = generateVatReport(`${YEAR}-K1`);
    markVatReportDeclared(report.id, "anvandare");
    bookVatOnTaxAccount(report.id, "anvandare");
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), 2_000);
  });
});

describe("F-skatt", () => {
  beforeEach(reset);

  it("dras från skattekontot mot 2518", () => {
    db().settings.fSkattPerMonth = 3_000;
    bookFSkatt(`${YEAR}-02`, "anvandare");
    assert.equal(accountBalance(F_SKATT, `${YEAR}-12-31`), 3_000);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -3_000);
  });

  it("en månad bokförs bara en gång", () => {
    db().settings.fSkattPerMonth = 3_000;
    const first = bookFSkatt(`${YEAR}-02`, "anvandare");
    const second = bookFSkatt(`${YEAR}-02`, "anvandare");
    assert.equal(first.id, second.id);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -3_000);
  });

  it("kräver att beloppet är satt", () => {
    db().settings.fSkattPerMonth = 0;
    assert.throws(() => bookFSkatt(`${YEAR}-02`, "anvandare"), /inte satt/);
  });

  it("kön listar förfallna månader men aldrig innevarande", () => {
    db().settings.fSkattPerMonth = 3_000;
    const months = fSkattMonthsAwaitingBooking(`${YEAR}-04-20`);
    assert.deepEqual(months, [`${YEAR}-01`, `${YEAR}-02`, `${YEAR}-03`]);
    bookFSkatt(`${YEAR}-01`, "anvandare");
    assert.deepEqual(fSkattMonthsAwaitingBooking(`${YEAR}-04-20`), [`${YEAR}-02`, `${YEAR}-03`]);
  });

  it("ingen kö när F-skatten inte är satt", () => {
    db().settings.fSkattPerMonth = 0;
    assert.deepEqual(fSkattMonthsAwaitingBooking(`${YEAR}-04-20`), []);
  });
});

describe("arbetsgivaravgifter och personalskatt", () => {
  beforeEach(reset);

  function bookPayroll(month: string) {
    postVerification({
      date: `${month}-25`,
      description: "Lön",
      entries: [
        { account: 7210, debit: 40_000 },
        { account: 7510, debit: 12_568 },
        { account: PERSONALSKATT, credit: 9_000 },
        { account: ARBETSGIVARAVGIFT, credit: 12_568 },
        { account: 1930, credit: 31_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
  }

  it("skuldkontona nollställs mot skattekontot", () => {
    bookPayroll(`${YEAR}-03`);
    bookEmployerTaxesOnTaxAccount(`${YEAR}-03`, "anvandare");
    assert.equal(accountBalance(ARBETSGIVARAVGIFT, `${YEAR}-12-31`), 0);
    assert.equal(accountBalance(PERSONALSKATT, `${YEAR}-12-31`), 0);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -21_568);
  });

  it("är idempotent och räknar inte om sin egen kontering", () => {
    bookPayroll(`${YEAR}-03`);
    const first = bookEmployerTaxesOnTaxAccount(`${YEAR}-03`, "anvandare");
    const second = bookEmployerTaxesOnTaxAccount(`${YEAR}-03`, "anvandare");
    assert.equal(first.id, second.id);
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), -21_568);
  });

  it("utan lön finns ingenting att föra över", () => {
    assert.throws(() => bookEmployerTaxesOnTaxAccount(`${YEAR}-03`, "anvandare"), /Ingen lön/);
  });
});

describe("inbetalning från banken", () => {
  beforeEach(reset);

  function bankTx(over: Partial<{ id: string; amount: number; description: string; counterpart: string }> = {}) {
    const tx = {
      id: over.id ?? "tx1",
      accountId: "acc",
      date: `${YEAR}-02-10`,
      amount: over.amount ?? -25_000,
      counterpart: over.counterpart ?? "Skatteverket",
      description: over.description ?? "Inbetalning skattekonto",
      status: "ny" as const,
    };
    db().bankTransactions.push(tx);
    return tx;
  }

  it("kandidater känns igen på motpart och text", () => {
    bankTx();
    bankTx({ id: "tx2", counterpart: "Beijer Byggmaterial", description: "Material" });
    assert.deepEqual(
      taxAccountDepositCandidates().map((t) => t.id),
      ["tx1"]
    );
  });

  it("bokförs som överföring 1930 till 1630 och markerar transaktionen", () => {
    const tx = bankTx();
    const ver = bookTaxAccountDeposit(tx.id, "anvandare");
    assert.equal(accountBalance(SKATTEKONTO, `${YEAR}-12-31`), 25_000);
    assert.equal(accountBalance(1930, `${YEAR}-12-31`), -25_000);
    assert.equal(db().bankTransactions[0].status, "bokford");
    assert.equal(db().bankTransactions[0].verificationId, ver.id);
    assert.equal(taxAccountDepositCandidates().length, 0);
  });

  it("en inbetalning måste vara ett uttag från företagskontot", () => {
    const tx = bankTx({ id: "tx3", amount: 5_000 });
    assert.throws(() => bookTaxAccountDeposit(tx.id, "anvandare"), /uttag/);
  });
});

describe("kontoutdraget", () => {
  it("läser datum, text och belopp oavsett kolumnavskiljare", () => {
    const rows = parseTaxAccountStatement(
      [
        `${YEAR}-02-12\tInbetalning\t25 000`,
        `${YEAR}-02-12;Moms kvartal 4;-18 400`,
        `${YEAR}-03-12   Debiterad preliminärskatt   -3 000`,
      ].join("\n")
    );
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], { date: `${YEAR}-02-12`, text: "Inbetalning", amount: 25_000 });
    assert.equal(rows[1].amount, -18_400);
    assert.equal(rows[2].amount, -3_000);
  });

  it("hoppar över rubriker och skräprader", () => {
    const rows = parseTaxAccountStatement(
      ["Datum\tText\tBelopp", "", "summering utan datum\t100", `${YEAR}-02-12\tInbetalning\t25 000`].join("\n")
    );
    assert.equal(rows.length, 1);
  });

  it("läser belopp med kronor och decimalkomma", () => {
    const rows = parseTaxAccountStatement(`${YEAR}-02-12\tRänta\t-12,50 kr`);
    assert.equal(rows[0].amount, -13);
  });
});

describe("avstämning mot skattekontoutdrag", () => {
  beforeEach(reset);

  function bookDeposit(date: string, amount: number) {
    postVerification({
      date,
      description: "Inbetalning till skattekontot",
      entries: [
        { account: SKATTEKONTO, debit: amount },
        { account: 1930, credit: amount },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
  }

  it("stämmer när utdraget och bokföringen visar samma rörelser", () => {
    bookDeposit(`${YEAR}-02-10`, 25_000);
    const result = reconcileTaxAccount(
      parseTaxAccountStatement(`${YEAR}-02-10\tInbetalning\t25 000`),
      `${YEAR}-12-31`
    );
    assert.equal(result.ok, true);
    assert.equal(result.difference, 0);
    assert.equal(result.statementRows, 1);
    assert.deepEqual(result.missingInLedger, []);
    assert.deepEqual(result.missingInStatement, []);
  });

  it("matchar över några dagars glapp mellan förfallodag och bokföringsdatum", () => {
    bookDeposit(`${YEAR}-02-10`, 25_000);
    const result = reconcileTaxAccount(
      parseTaxAccountStatement(`${YEAR}-02-12\tInbetalning\t25 000`),
      `${YEAR}-12-31`
    );
    assert.equal(result.ok, true);
  });

  it("ränta som Skatteverket lagt på kontot pekas ut, inte gömd i differensen", () => {
    bookDeposit(`${YEAR}-02-10`, 25_000);
    const result = reconcileTaxAccount(
      parseTaxAccountStatement([`${YEAR}-02-10\tInbetalning\t25 000`, `${YEAR}-03-01\tRänta\t-120`].join("\n")),
      `${YEAR}-12-31`
    );
    assert.equal(result.ok, false);
    assert.equal(result.difference, -120);
    assert.equal(result.missingInLedger.length, 1);
    assert.equal(result.missingInLedger[0].text, "Ränta");
    assert.deepEqual(result.missingInStatement, []);
  });

  it("bokfört som saknas i utdraget listas separat", () => {
    bookDeposit(`${YEAR}-02-10`, 25_000);
    bookDeposit(`${YEAR}-06-10`, 5_000);
    const result = reconcileTaxAccount(
      parseTaxAccountStatement(`${YEAR}-02-10\tInbetalning\t25 000`),
      `${YEAR}-12-31`
    );
    assert.equal(result.ok, false);
    assert.equal(result.missingInStatement.length, 1);
    assert.equal(result.missingInStatement[0].amount, 5_000);
    assert.equal(result.difference, -5_000);
  });

  it("ingående balans räknas in i utdragets saldo", () => {
    db().fiscalYears[0].openingBalances = { [String(SKATTEKONTO)]: 4_000 };
    bookDeposit(`${YEAR}-02-10`, 1_000);
    const result = reconcileTaxAccount(
      parseTaxAccountStatement(`${YEAR}-02-10\tInbetalning\t1 000`),
      `${YEAR}-12-31`
    );
    assert.equal(result.statementBalance, 5_000);
    assert.equal(result.ledgerBalance, 5_000);
    assert.equal(result.ok, true);
  });
});
