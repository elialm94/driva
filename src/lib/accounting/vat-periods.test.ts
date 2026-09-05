process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { calendarFiscalYear, vatDueDate, vatPeriodsOf, vatPeriodicityOfRange } from "./dates";
import { vatPeriodFor, vatPeriodicity } from "./fiscal";
import { generateVatReport, markVatReportDeclared, setVatPeriodicity, vatPeriods } from "./vat";
import { postVerification } from "./engine";
import type { VatPeriodicity } from "../types";

/**
 * Momsperioder: helår, kvartal och månad, med den förfallodag
 * skatteförfarandelagen ger för respektive periodicitet.
 */

const THIS_YEAR = Number(new Date().toISOString().slice(0, 4));

function reset(periodicity?: VatPeriodicity) {
  replaceDb(emptyTestDb());
  if (periodicity) db().settings.vatPeriodicity = periodicity;
}

describe("momsperiodernas indelning", () => {
  const fy = calendarFiscalYear(2026);

  it("helår är en enda period som täcker räkenskapsåret", () => {
    const periods = vatPeriodsOf(fy, "helar");
    assert.equal(periods.length, 1);
    assert.equal(periods[0].start, "2026-01-01");
    assert.equal(periods[0].end, "2026-12-31");
    assert.equal(periods[0].key, "2026-H");
  });

  it("kvartal är fyra perioder om tre månader", () => {
    const periods = vatPeriodsOf(fy, "kvartal");
    assert.equal(periods.length, 4);
    assert.deepEqual(
      periods.map((p) => [p.start, p.end]),
      [
        ["2026-01-01", "2026-03-31"],
        ["2026-04-01", "2026-06-30"],
        ["2026-07-01", "2026-09-30"],
        ["2026-10-01", "2026-12-31"],
      ]
    );
  });

  it("månad är tolv perioder", () => {
    const periods = vatPeriodsOf(fy, "manad");
    assert.equal(periods.length, 12);
    assert.equal(periods[1].start, "2026-02-01");
    assert.equal(periods[1].end, "2026-02-28");
  });

  it("periodiciteten härleds ur intervallets längd", () => {
    assert.equal(vatPeriodicityOfRange("2026-01-01", "2026-01-31"), "manad");
    assert.equal(vatPeriodicityOfRange("2026-01-01", "2026-03-31"), "kvartal");
    assert.equal(vatPeriodicityOfRange("2026-01-01", "2026-12-31"), "helar");
  });
});

describe("förfallodag per periodicitet", () => {
  const fy = calendarFiscalYear(2026);

  it("kvartal: 12:e i andra månaden efter, men 17:e i januari och augusti", () => {
    const [q1, q2, q3, q4] = vatPeriodsOf(fy, "kvartal");
    assert.equal(vatDueDate(q1), "2026-05-12");
    // Andra månaden efter juni är augusti – då gäller den 17:e.
    assert.equal(vatDueDate(q2), "2026-08-17");
    assert.equal(vatDueDate(q3), "2026-11-12");
    assert.equal(vatDueDate(q4), "2027-02-12");
  });

  it("månad: samma regel, med 17:e för januari och augusti", () => {
    const months = vatPeriodsOf(fy, "manad");
    assert.equal(vatDueDate(months[0]), "2026-03-12"); // januari → 12 mars
    assert.equal(vatDueDate(months[5]), "2026-08-17"); // juni → 17 augusti
    assert.equal(vatDueDate(months[10]), "2027-01-17"); // november → 17 januari
    assert.equal(vatDueDate(months[11]), "2027-02-12"); // december → 12 februari
  });

  it("helår: i anslutning till inkomstdeklarationen, styrt av räkenskapsårets slut", () => {
    // Kalenderår (slutar i december) → 17 augusti året efter.
    assert.equal(vatDueDate(vatPeriodsOf(fy, "helar")[0]), "2027-08-17");
    // Brutna år, digital inlämning: Skatteverkets tabell.
    assert.equal(vatDueDate({ key: "", label: "", start: "2025-05-01", end: "2026-04-30" }), "2026-12-12");
    assert.equal(vatDueDate({ key: "", label: "", start: "2025-07-01", end: "2026-06-30" }), "2027-01-17");
    assert.equal(vatDueDate({ key: "", label: "", start: "2025-09-01", end: "2026-08-31" }), "2027-04-12");
  });
});

describe("företagets inställning styr perioderna", () => {
  beforeEach(() => reset());

  it("kvartal är default när inget är valt", () => {
    assert.equal(db().settings.vatPeriodicity, undefined);
    assert.equal(vatPeriodicity(), "kvartal");
    assert.equal(vatPeriods(THIS_YEAR).length, 4);
  });

  it("helår ger en period, månad ger tolv", () => {
    db().settings.vatPeriodicity = "helar";
    assert.equal(vatPeriods(THIS_YEAR).length, 1);
    db().settings.vatPeriodicity = "manad";
    assert.equal(vatPeriods(THIS_YEAR).length, 12);
  });

  it("perioden för ett datum följer inställningen", () => {
    assert.equal(vatPeriodFor(`${THIS_YEAR}-02-15`).end, `${THIS_YEAR}-03-31`);
    db().settings.vatPeriodicity = "manad";
    assert.equal(vatPeriodFor(`${THIS_YEAR}-02-15`).end, `${THIS_YEAR}-02-28`);
    db().settings.vatPeriodicity = "helar";
    assert.equal(vatPeriodFor(`${THIS_YEAR}-02-15`).end, `${THIS_YEAR}-12-31`);
  });

  it("momsrapporten skapas för perioden nyckeln pekar på", () => {
    db().settings.vatPeriodicity = "manad";
    const report = generateVatReport(`${THIS_YEAR}-03`);
    assert.equal(report.periodStart, `${THIS_YEAR}-03-01`);
    assert.equal(report.periodEnd, `${THIS_YEAR}-03-31`);
  });

  it("en nyckel från en annan periodicitet fungerar fortfarande", () => {
    // Rapporter skapade före ett byte måste gå att öppna efteråt.
    db().settings.vatPeriodicity = "manad";
    const report = generateVatReport(`${THIS_YEAR}-K1`);
    assert.equal(report.periodStart, `${THIS_YEAR}-01-01`);
    assert.equal(report.periodEnd, `${THIS_YEAR}-03-31`);
  });

  it("helårsrapporten summerar hela året", () => {
    db().settings.vatPeriodicity = "helar";
    postVerification({
      date: `${THIS_YEAR}-02-10`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 1250 },
        { account: 3001, credit: 1000 },
        { account: 2611, credit: 250 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    postVerification({
      date: `${THIS_YEAR}-11-10`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 625 },
        { account: 3001, credit: 500 },
        { account: 2611, credit: 125 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const report = generateVatReport(`${THIS_YEAR}-H`);
    assert.equal(report.utgaende, 375);
    assert.equal(report.attBetala, 375);
  });
});

describe("byte av momsperiod", () => {
  beforeEach(() => reset());

  it("sparas på företaget och loggas", () => {
    setVatPeriodicity("manad", "anvandare");
    assert.equal(db().settings.vatPeriodicity, "manad");
    assert.ok(db().auditTrail.some((e) => e.action === "momsperiodicitet_andrad"));
  });

  it("utkast för året tas bort – de hör till den gamla indelningen", () => {
    generateVatReport(`${THIS_YEAR}-K1`);
    assert.equal(db().vatReports.length, 1);
    setVatPeriodicity("manad", "anvandare");
    assert.equal(db().vatReports.length, 0);
  });

  it("vägras när en period i året redan är deklarerad", () => {
    const lastYear = THIS_YEAR - 1;
    replaceDb(emptyTestDb());
    postVerification({
      date: `${THIS_YEAR}-01-10`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 1250 },
        { account: 3001, credit: 1000 },
        { account: 2611, credit: 250 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    // Deklarera en avslutad period: första kvartalet föregående år räcker inte
    // (fel år), så vi lägger deklarationen i innevarande år via en fejkad
    // rapport som redan är deklarerad.
    db().vatReports.push({
      id: "moms-deklarerad",
      fiscalYearId: db().fiscalYears[0]?.id ?? "fy",
      periodStart: `${THIS_YEAR}-01-01`,
      periodEnd: `${THIS_YEAR}-03-31`,
      label: `januari–mars ${THIS_YEAR}`,
      status: "deklarerad",
      boxes: [],
      utgaende: 250,
      ingaende: 0,
      attBetala: 250,
      generatedAt: new Date().toISOString(),
    });
    assert.throws(() => setVatPeriodicity("manad", "anvandare"), /redan deklarerad/);
    assert.equal(vatPeriodicity(), "kvartal");
    assert.equal(lastYear, THIS_YEAR - 1);
  });
});

describe("deklarationsordning med månadsmoms", () => {
  it("tidigare månader med momsaktivitet måste deklareras först", () => {
    reset("manad");
    const lastYear = THIS_YEAR - 1;
    for (const month of ["01", "02"]) {
      postVerification({
        date: `${lastYear}-${month}-10`,
        description: "Försäljning",
        entries: [
          { account: 1930, debit: 1250 },
          { account: 3001, credit: 1000 },
          { account: 2611, credit: 250 },
        ],
        source: { type: "manuell" },
      createdBy: "anvandare",
      });
    }
    const february = generateVatReport(`${lastYear}-02`);
    assert.throws(() => markVatReportDeclared(february.id, "anvandare"), /januari/);

    const january = generateVatReport(`${lastYear}-01`);
    markVatReportDeclared(january.id, "anvandare");
    markVatReportDeclared(february.id, "anvandare");
    assert.equal(db().vatReports.filter((r) => r.status === "deklarerad").length, 2);
  });
});
