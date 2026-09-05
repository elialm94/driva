process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, labor, testCustomer } from "../invoices/test-db";
import type { Invoice } from "../types";
import { accountBalance } from "./ledger";
import { postVerification } from "./engine";
import { runPayroll, saveEmployee } from "./payroll";
import { planAccrual } from "./accruals";
import { bokslutChecklist } from "./close";
import { createDepreciationEntry, registerAssetFromExpense } from "./assets";
import {
  ATERFORING_PERIODISERINGSFOND,
  AVSATTNING_PERIODISERINGSFOND,
  BEFARADE_KUNDFORLUSTER,
  NEDSKRIVNING_KUNDFORDRINGAR,
  PERIODISERINGSFOND,
  SEMESTERLONESKULD,
  SEMESTERLONESKULD_KOSTNAD,
  SOCIALA_AVGIFTER_SKULD_KOSTNAD,
  UPPLUPNA_SOCIALA_AVGIFTER,
  bookYearEndSchedule,
  doubtfulSuggestions,
  fundLots,
  fundReversalsDue,
  maxFundAllocation,
  saveYearEndSchedule,
  schedulesAwaitingBooking,
  vacationDayValue,
  vacationLiabilityDraft,
  yearEndScheduleFor,
} from "./year-end";
import { balanceReconciliation } from "./balance-reconciliation";

/**
 * Bokslutsbilagorna är svaret på revisorns fråga: vad BESTÅR saldot av?
 *
 * Testerna håller fast fyra saker som annars går sönder tyst:
 *   1. Bilagan bokför FÖRÄNDRINGEN, inte totalen – annars dubblas skulden år två.
 *   2. Periodiseringsfonden respekterar 25 %-taket och sexårsregeln.
 *   3. Nedskrivningen sker exklusive moms och rör inte fordran.
 *   4. Avstämningen hittar en skillnad mot delsystemet i stället för att dölja den.
 */

const YEAR = 2026;
const MONTHLY = 40_000;

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Kund AB" })] }));
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

function hire() {
  return saveEmployee(
    {
      name: "Anna Ek",
      personnummer: "19850612-1234",
      role: "foretagsledare",
      monthlySalary: MONTHLY,
      taxBasis: { kind: "procent", percent: 30 },
      startDate: `${YEAR}-01-01`,
    },
    "anvandare"
  );
}

/** Skuldkontots saldo som positivt belopp – huvudboken räknar debet minus kredit. */
function liability(account: number): number {
  return -accountBalance(account, `${YEAR}-12-31`);
}

function cost(account: number): number {
  return accountBalance(account, `${YEAR}-12-31`);
}

function sendInvoice(over: Partial<Invoice> & { id: string; number: number; dueDate: string }): Invoice {
  const invoice: Invoice = {
    customerId: "cust-1",
    type: "faktura",
    status: "skickad",
    lines: [labor({ description: "Arbete", unitPrice: 10_000 })],
    rot: null,
    issueDate: `${YEAR}-03-01`,
    paymentTermsDays: 30,
    reminders: [],
    token: over.id,
    ocr: String(over.number),
    createdAt: `${YEAR}-03-01`,
    issuedAt: `${YEAR}-03-01`,
    ...over,
  };
  db().invoices.push(invoice);
  return invoice;
}

describe("semesterlöneskuld", () => {
  beforeEach(reset);

  it("en sparad dag är semesterlön plus semestertillägg på månadslönen", () => {
    const value = vacationDayValue(MONTHLY);
    assert.equal(value.semesterlon, 1_840); // 4,6 % av 40 000
    assert.equal(value.tillagg, 172); // 0,43 % av 40 000
    assert.equal(value.perDay, 2_012);
  });

  it("skulden bokförs med sociala avgifter, och bara förändringen", () => {
    hire();
    saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 10 }, "anvandare");
    const schedule = bookYearEndSchedule(yearEndScheduleFor("fy", "semesterloneskuld")!.id, "anvandare");

    const skuld = 10 * vacationDayValue(MONTHLY).perDay;
    assert.equal(schedule.closingAmount, skuld);
    assert.equal(liability(SEMESTERLONESKULD), skuld);
    assert.equal(cost(SEMESTERLONESKULD_KOSTNAD), skuld);
    // Avgifterna följer den anställdes ålder, precis som lönen.
    const avgift = Math.round((skuld * 31.42) / 100);
    assert.equal(liability(UPPLUPNA_SOCIALA_AVGIFTER), avgift);
    assert.equal(cost(SOCIALA_AVGIFTER_SKULD_KOSTNAD), avgift);
    assert.equal(schedule.verificationIds.length, 2);
  });

  it("bilagan visar utgående skuld men bokför skillnaden mot kontot", () => {
    hire();
    saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 10 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "semesterloneskuld")!.id, "anvandare");
    const efterTioDagar = liability(SEMESTERLONESKULD);

    // Justeringen mot ett konto som redan bär skulden ska vara skillnaden.
    const draft = vacationLiabilityDraft("fy", 12);
    assert.equal(draft.bookedAmount, efterTioDagar);
    assert.equal(draft.change, 2 * vacationDayValue(MONTHLY).perDay);
  });

  it("en felräknad bilaga går att rätta så länge året är öppet", () => {
    hire();
    saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 10 }, "anvandare");
    const forstaVerifikationer = [
      ...bookYearEndSchedule(yearEndScheduleFor("fy", "semesterloneskuld")!.id, "anvandare").verificationIds,
    ];

    // Det var 12 dagar, inte 10. Rättelsen sätter bilagan i utkast igen så
    // ändringen inte blir liggande obokförd.
    const reviderad = saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 12 }, "anvandare");
    assert.equal(reviderad.status, "utkast");
    assert.ok(schedulesAwaitingBooking("fy").some((s) => s.kind === "semesterloneskuld"));

    const bokford = bookYearEndSchedule(reviderad.id, "anvandare");
    // Kontot bär bilagans belopp – inte summan av båda bokföringarna.
    assert.equal(liability(SEMESTERLONESKULD), 12 * vacationDayValue(MONTHLY).perDay);
    assert.equal(bokford.closingAmount, liability(SEMESTERLONESKULD));
    // De första verifikationerna står kvar; rättelsen ligger i nya.
    assert.ok(bokford.verificationIds.length > forstaVerifikationer.length);
    for (const id of forstaVerifikationer) assert.ok(bokford.verificationIds.includes(id));
  });

  it("utan anställd finns ingen semesterlöneskuld att bokföra", () => {
    assert.throws(() => saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 5 }, "anvandare"), /Ingen anställd/);
  });

  it("lönen gör semesterlöneskulden till en bokslutspunkt", () => {
    hire();
    runPayroll({ month: `${YEAR}-01` }, "anvandare");
    assert.ok(schedulesAwaitingBooking("fy").some((s) => s.kind === "semesterloneskuld"));
    saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 0 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "semesterloneskuld")!.id, "anvandare");
    assert.equal(schedulesAwaitingBooking("fy").filter((s) => s.kind === "semesterloneskuld").length, 0);
  });
});

describe("nedskrivning av kundfordringar", () => {
  beforeEach(reset);

  it("föreslår bara fordringar som legat förfallna länge", () => {
    sendInvoice({ id: "gammal", number: 1, dueDate: `${YEAR}-04-01` });
    sendInvoice({ id: "ny", number: 2, dueDate: `${YEAR}-11-20` });
    const suggestions = doubtfulSuggestions("fy", `${YEAR}-12-01`);
    assert.deepEqual(
      suggestions.map((s) => s.invoice.id),
      ["gammal"]
    );
  });

  it("skriver ned exklusive moms och lämnar fordran orörd", () => {
    const invoice = sendInvoice({ id: "gammal", number: 1, dueDate: `${YEAR}-04-01` });
    saveYearEndSchedule("fy", "kundfordringar_nedskrivning", { doubtfulInvoiceIds: [invoice.id] }, "anvandare");
    const schedule = bookYearEndSchedule(yearEndScheduleFor("fy", "kundfordringar_nedskrivning")!.id, "anvandare");

    // En arbetsrad på 10 000 kr med 25 % moms: 12 500 kr att betala, 10 000 exkl.
    assert.equal(schedule.closingAmount, 10_000);
    assert.equal(liability(NEDSKRIVNING_KUNDFORDRINGAR), 10_000);
    assert.equal(cost(BEFARADE_KUNDFORLUSTER), 10_000);
    // Fordran är en bedömning, inte en avskrivning: 1510 rörs inte.
    assert.equal(accountBalance(1510, `${YEAR}-12-31`), 0);
  });

  it("noll osäkra fordringar är också ett svar", () => {
    saveYearEndSchedule("fy", "kundfordringar_nedskrivning", { doubtfulInvoiceIds: [] }, "anvandare");
    const schedule = bookYearEndSchedule(yearEndScheduleFor("fy", "kundfordringar_nedskrivning")!.id, "anvandare");
    assert.equal(schedule.closingAmount, 0);
    assert.equal(schedule.verificationIds.length, 0);
    assert.equal(schedule.status, "bokford");
  });
});

describe("periodiseringsfond", () => {
  beforeEach(reset);

  function profit(amount: number) {
    // En intäkt utan motsvarande kostnad ger årets vinst.
    postVerification({
      date: `${YEAR}-06-30`,
      description: "Vinst",
      entries: [
        { account: 1930, debit: amount },
        { account: 3001, credit: amount },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
  }

  it("taket är 25 % av det skattemässiga resultatet före avsättning", () => {
    profit(400_000);
    assert.equal(maxFundAllocation("fy"), 100_000);
  });

  it("avsättning över taket avvisas med taket i klartext", () => {
    profit(400_000);
    assert.throws(
      () => saveYearEndSchedule("fy", "periodiseringsfond", { fundAllocation: 150_000, fundReversals: [] }, "anvandare"),
      /högst 100000 kr/
    );
  });

  it("avsättningen bokförs som bokslutsdisposition och sänker resultatet", () => {
    profit(400_000);
    saveYearEndSchedule("fy", "periodiseringsfond", { fundAllocation: 100_000, fundReversals: [] }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "periodiseringsfond")!.id, "anvandare");
    assert.equal(liability(PERIODISERINGSFOND), 100_000);
    assert.equal(cost(AVSATTNING_PERIODISERINGSFOND), 100_000);
    // Taket räknas på resultatet FÖRE avsättning, så det ändras inte av att
    // avsättningen bokförts.
    assert.equal(maxFundAllocation("fy"), 100_000);
  });

  it("fonden hålls per avsättningsår med sista återföringsår", () => {
    profit(400_000);
    saveYearEndSchedule("fy", "periodiseringsfond", { fundAllocation: 100_000, fundReversals: [] }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "periodiseringsfond")!.id, "anvandare");
    const lots = fundLots("fy");
    assert.deepEqual(lots, [{ year: YEAR, amount: 100_000, lastYear: YEAR + 6 }]);
  });

  it("sjätte året tvingar återföring", () => {
    profit(400_000);
    saveYearEndSchedule("fy", "periodiseringsfond", { fundAllocation: 100_000, fundReversals: [] }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "periodiseringsfond")!.id, "anvandare");

    const later = {
      id: "fy6",
      label: String(YEAR + 6),
      startDate: `${YEAR + 6}-01-01`,
      endDate: `${YEAR + 6}-12-31`,
      status: "oppet" as const,
      openingBalances: { [PERIODISERINGSFOND]: -100_000 },
      openingSource: "foregaende_ar" as const,
    };
    db().fiscalYears.push(later);

    assert.deepEqual(fundReversalsDue("fy6"), [{ year: YEAR, amount: 100_000, lastYear: YEAR + 6 }]);
    assert.throws(
      () => saveYearEndSchedule("fy6", "periodiseringsfond", { fundAllocation: 0, fundReversals: [] }, "anvandare"),
      /senast räkenskapsåret/
    );

    saveYearEndSchedule(
      "fy6",
      "periodiseringsfond",
      { fundAllocation: 0, fundReversals: [{ year: YEAR, amount: 100_000 }] },
      "anvandare"
    );
    bookYearEndSchedule(yearEndScheduleFor("fy6", "periodiseringsfond")!.id, "anvandare");
    assert.equal(accountBalance(PERIODISERINGSFOND, `${YEAR + 6}-12-31`), 0);
    assert.equal(accountBalance(ATERFORING_PERIODISERINGSFOND, `${YEAR + 6}-12-31`), -100_000);
    assert.deepEqual(fundLots("fy6"), []);
  });

  it("mer än fonden går inte att återföra", () => {
    profit(400_000);
    saveYearEndSchedule("fy", "periodiseringsfond", { fundAllocation: 100_000, fundReversals: [] }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "periodiseringsfond")!.id, "anvandare");
    db().fiscalYears.push({
      id: "fy2",
      label: String(YEAR + 1),
      startDate: `${YEAR + 1}-01-01`,
      endDate: `${YEAR + 1}-12-31`,
      status: "oppet",
      openingBalances: { [PERIODISERINGSFOND]: -100_000 },
      openingSource: "foregaende_ar",
    });
    assert.throws(
      () =>
        saveYearEndSchedule(
          "fy2",
          "periodiseringsfond",
          { fundAllocation: 0, fundReversals: [{ year: YEAR, amount: 150_000 }] },
          "anvandare"
        ),
      /mer än så går inte att återföra/
    );
  });
});

describe("avstämning per balanskonto", () => {
  beforeEach(reset);

  it("kundfordringar stäms av mot de obetalda fakturorna", () => {
    sendInvoice({ id: "inv-1", number: 1, dueDate: `${YEAR}-04-01` });
    // Fordran finns i delsystemet men är inte bokförd: skillnaden syns.
    const before = balanceReconciliation("fy");
    const row = before.rows.find((r) => r.account === 1510);
    assert.ok(row, "kundfordringskontot ska vara med när det finns en fordran");
    assert.equal(row.subsystem, 12_500);
    assert.equal(row.difference, -12_500);
    assert.equal(row.ok, false);
    assert.ok(before.unexplained.some((r) => r.account === 1510));
  });

  it("inventarier stäms av mot inventarieregistret", () => {
    db().expenses.push({
      id: "exp-1",
      supplier: "Verktygsbolaget",
      description: "Skruvdragare",
      date: `${YEAR}-02-01`,
      amount: 37_500,
      vatAmount: 7_500,
      status: "saknar_kvitto",
      createdAt: `${YEAR}-02-01`,
    });
    const asset = registerAssetFromExpense("exp-1", { by: "anvandare" });
    createDepreciationEntry(asset.id, "fy", "anvandare");
    const rec = balanceReconciliation("fy");
    const assetRow = rec.rows.find((r) => r.account === asset.assetAccount);
    const depRow = rec.rows.find((r) => r.account === asset.accumulatedDepreciationAccount);
    assert.equal(assetRow?.ok, true);
    assert.equal(depRow?.ok, true);
  });

  it("interimskontona stäms av mot periodiseringarna", () => {
    planAccrual({
      kind: "forutbetald_kostnad",
      description: "Årslicens",
      totalAmount: 12_000,
      counterAccount: 5420,
      fromDate: `${YEAR}-07-01`,
      toDate: `${YEAR + 1}-06-30`,
      fiscalYearId: "fy",
      by: "anvandare",
    });
    // Planerad men obokförd periodisering rör inte kontot – inget att stämma av.
    assert.equal(balanceReconciliation("fy").rows.some((r) => r.account === 1710), false);
  });

  it("ett saldo utan delsystem stäms av för hand i stället för att stoppa bokslutet", () => {
    postVerification({
      date: `${YEAR}-05-01`,
      description: "Lån från närstående",
      entries: [
        { account: 1930, debit: 50_000 },
        { account: 2393, credit: 50_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const rec = balanceReconciliation("fy");
    const row = rec.rows.find((r) => r.account === 2393);
    // Driva har inget lånregister, så saldot går inte att verifiera maskinellt.
    // Att stoppa bokslutet på det vore att kräva ett svar användaren inte kan
    // ge i produkten – men det får inte heller tyst passera som avstämt.
    assert.equal(row?.manual, true);
    assert.equal(row?.ok, true);
    assert.match(row!.detail, /utan delsystem/);
    assert.ok(rec.manual.some((r) => r.account === 2393));
    assert.ok(!rec.unexplained.some((r) => r.account === 2393));
    assert.equal(rec.ok, true);
  });

  it("en fond som ligger kvar är förklarad även året då ingen bilaga upprättas", () => {
    /*
     * Fonden avsätts ett år och står stilla i upp till sex. Året därpå finns
     * ingen bilaga att upprätta – men saldot är fullt förklarat av lotten från
     * avsättningsåret, och bokslutet får inte fastna på ett underlag som redan
     * finns.
     */
    db().fiscalYears.push({
      id: "fy-next",
      label: String(YEAR + 1),
      startDate: `${YEAR + 1}-01-01`,
      endDate: `${YEAR + 1}-12-31`,
      status: "oppet",
      openingBalances: { [PERIODISERINGSFOND]: -60_000 },
      openingSource: "foregaende_ar",
    });
    postVerification({
      date: `${YEAR}-06-01`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 300_000 },
        { account: 3001, credit: 300_000 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const fund = saveYearEndSchedule(
      "fy",
      "periodiseringsfond",
      { fundAllocation: 60_000, fundReversals: [] },
      "anvandare"
    );
    bookYearEndSchedule(fund.id, "anvandare");

    const rec = balanceReconciliation("fy-next");
    const row = rec.rows.find((r) => r.account === PERIODISERINGSFOND);
    assert.equal(yearEndScheduleFor("fy-next", "periodiseringsfond"), undefined, "året har ingen egen bilaga");
    assert.equal(row?.subsystem, -60_000);
    assert.equal(row?.difference, 0);
    assert.equal(row?.ok, true);
    assert.match(row!.detail, new RegExp(`avsatt ${YEAR}`));
  });

  it("bilagekontot stäms av mot bilagan", () => {
    hire();
    saveYearEndSchedule("fy", "semesterloneskuld", { savedVacationDays: 10 }, "anvandare");
    bookYearEndSchedule(yearEndScheduleFor("fy", "semesterloneskuld")!.id, "anvandare");
    const rec = balanceReconciliation("fy");
    assert.equal(rec.rows.find((r) => r.account === SEMESTERLONESKULD)?.ok, true);
    assert.equal(rec.rows.find((r) => r.account === UPPLUPNA_SOCIALA_AVGIFTER)?.ok, true);
  });

  it("bokslutet blockeras av en obalanserad balanspost", () => {
    sendInvoice({ id: "inv-1", number: 1, dueDate: `${YEAR}-04-01` });
    const check = bokslutChecklist("fy").find((c) => c.key === "avstamning");
    assert.equal(check?.ok, false);
    assert.equal(check?.blocking, true);
    assert.match(check!.detail!, /1510/);
  });
});
