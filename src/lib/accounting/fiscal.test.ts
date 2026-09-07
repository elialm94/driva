process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "./engine";
import { huvudbok } from "./ledger";
import {
  calendarFiscalYear,
  createNextFiscalYear,
  currentFiscalYear,
  ensureFiscalYearFor,
  fiscalYearFollowing,
  fiscalYearLabel,
  fiscalYears,
  fiscalYearToExtend,
  monthsOf,
  quartersOf,
  resolveViewFiscalYear,
  todayDate,
  updateFiscalYearPeriod,
} from "./fiscal";
import { makeFiscalYear, yearsToCoverDate } from "./dates";

const YEAR = Number(todayDate().slice(0, 4));

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

describe("räkenskapsår – default och inställning", () => {
  beforeEach(() => reset());

  it("ett nytt företag får 1 januari–31 december utan setup-wizard", () => {
    const fy = currentFiscalYear();
    assert.equal(fy.startDate, `${YEAR}-01-01`);
    assert.equal(fy.endDate, `${YEAR}-12-31`);
    assert.equal(fy.label, String(YEAR));
    assert.equal(fy.status, "oppet");
  });

  it("huvudbokens period följer räkenskapsåret", () => {
    postVerification({
      date: `${YEAR}-03-15`,
      description: "Försäljning i år",
      entries: [
        { account: 1930, debit: 1250 },
        { account: 3001, credit: 1000 },
        { account: 2611, credit: 250 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const fy = currentFiscalYear();
    const accounts = huvudbok({ from: fy.startDate, to: fy.endDate });
    const sales = accounts.find((a) => a.account === 3001);
    assert.ok(sales);
    assert.equal(sales.rows.length, 1);
    assert.equal(sales.rows[0].date, `${YEAR}-03-15`);
  });

  it("verifikationer behåller sitt bokföringsdatum när året ändras", () => {
    postVerification({
      date: `${YEAR}-02-10`,
      description: "Försäljning",
      entries: [
        { account: 1930, debit: 1250 },
        { account: 3001, credit: 1000 },
        { account: 2611, credit: 250 },
      ],
      source: { type: "manuell" },
      createdBy: "anvandare",
    });
    const booked = db().verifications[0].date;
    const fy = currentFiscalYear();
    updateFiscalYearPeriod(fy.id, `${YEAR - 1}-07-01`, `${YEAR}-06-30`);
    assert.equal(db().verifications[0].date, booked);
    assert.equal(db().verifications[0].description, "Försäljning");
  });

  it("tillåter brutet år så länge slutet är efter starten", () => {
    const fy = currentFiscalYear();
    const updated = updateFiscalYearPeriod(fy.id, `${YEAR}-05-01`, `${YEAR + 1}-04-30`);
    assert.equal(updated.startDate, `${YEAR}-05-01`);
    assert.equal(updated.endDate, `${YEAR + 1}-04-30`);
    assert.equal(updated.label, `${YEAR}/${YEAR + 1}`);
    assert.throws(() => updateFiscalYearPeriod(fy.id, `${YEAR}-05-01`, `${YEAR}-04-30`), /efter startdatum/);
  });

  it("skapa nästa år följer det brutna mönstret", () => {
    const fy = currentFiscalYear();
    updateFiscalYearPeriod(fy.id, `${YEAR - 1}-07-01`, `${YEAR}-06-30`);
    const next = createNextFiscalYear();
    assert.equal(next.startDate, `${YEAR}-07-01`);
    assert.equal(next.endDate, `${YEAR + 1}-06-30`);
    assert.equal(next.label, `${YEAR}/${YEAR + 1}`);
    assert.equal(createNextFiscalYear().id, next.id, "finns nästa år redan ska knappen inte skapa ett till");
  });
});

describe("räkenskapsår – perioder och kedja", () => {
  it("kalenderår behåller samma månads- och kvartalsnycklar", () => {
    const fy = calendarFiscalYear(2026);
    const months = monthsOf(fy);
    assert.equal(months.length, 12);
    assert.equal(months[0].start, "2026-01-01");
    assert.equal(months[0].end, "2026-01-31");
    assert.equal(months[0].key, "2026-01");
    const quarters = quartersOf(fy);
    assert.equal(quarters.length, 4);
    assert.equal(quarters[0].key, "2026-K1");
    assert.equal(quarters[0].start, "2026-01-01");
    assert.equal(quarters[0].end, "2026-03-31");
    assert.equal(quarters[0].label, "januari–mars 2026");
  });

  it("brutet år ger månader och kvartal ur start och slut", () => {
    const fy = makeFiscalYear("2025-05-01", "2026-04-30");
    const months = monthsOf(fy);
    assert.equal(months.length, 12);
    assert.equal(months[0].start, "2025-05-01");
    assert.equal(months[0].key, "2025-05");
    assert.equal(months[11].end, "2026-04-30");
    const quarters = quartersOf(fy);
    assert.equal(quarters.length, 4);
    assert.equal(quarters[0].start, "2025-05-01");
    assert.equal(quarters[0].end, "2025-07-31");
    assert.equal(quarters[3].end, "2026-04-30");
  });

  it("ensureFiscalYearFor följer det brutna mönstret framåt", () => {
    reset({
      fiscalYears: [makeFiscalYear("2025-07-01", "2026-06-30")],
    });
    const next = ensureFiscalYearFor("2026-09-15");
    assert.equal(next.startDate, "2026-07-01");
    assert.equal(next.endDate, "2027-06-30");
    assert.equal(fiscalYearLabel(next.startDate, next.endDate), "2026/2027");
  });

  it("yearsToCoverDate fyller luckor utan att överlappa", () => {
    const existing = [calendarFiscalYear(2024), calendarFiscalYear(2026)];
    const extra = yearsToCoverDate(existing, "2025-03-01");
    assert.equal(extra.length, 1);
    assert.equal(extra[0].startDate, "2025-01-01");
    assert.equal(extra[0].endDate, "2025-12-31");
  });

  it("fiscalYearToExtend tar det avslutade året före innevarande", () => {
    const older = makeFiscalYear("2024-07-01", "2025-06-30");
    const current = makeFiscalYear("2025-07-01", "2026-06-30");
    const next = makeFiscalYear("2026-07-01", "2027-06-30");
    assert.equal(fiscalYearToExtend([older, current], "2026-03-01")?.startDate, older.startDate);
    assert.equal(fiscalYearToExtend([older, current, next], "2026-09-01")?.startDate, current.startDate);
    assert.equal(fiscalYearToExtend([current], "2026-03-01")?.startDate, current.startDate);
  });

  it("resolveViewFiscalYear väljer innevarande år eller query-param", () => {
    reset();
    const current = currentFiscalYear();
    const next = fiscalYearFollowing(current);
    db().fiscalYears.push(next);
    assert.equal(resolveViewFiscalYear().id, current.id);
    assert.equal(resolveViewFiscalYear(next.label).id, next.id);
    assert.equal(resolveViewFiscalYear(next.id).id, next.id);
    assert.equal(fiscalYears().length >= 2, true);
  });
});
