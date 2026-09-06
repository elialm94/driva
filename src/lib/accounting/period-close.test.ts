process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { calendarFiscalYear } from "./dates";
import { postVerification } from "./engine";
import { lockedThrough } from "./fiscal";
import { auditTrail } from "./audit";
import { annualReportDueDate, ink2DueDate } from "./deadlines";
import { listBookkeepingAttention } from "../services/actions";
import { controlsForAction, issueForAction } from "../services/action-issue";
import {
  closePeriod,
  monthsAwaitingClose,
  nextMonthToClose,
  periodCloseStatus,
  PeriodCloseError,
} from "./period-close";

/**
 * Periodstängning: månadsavstämningen som ett flöde.
 *
 * Det som hålls fast här är inte knappen utan ordningen och vägran. Låset är
 * ett enda datum som bara går framåt, så en stängning av mars hade svept med
 * februari om ordningen inte upprätthölls – och en stängning som accepteras
 * medan banken skvalpar är värdelös som intyg.
 */

const FY = 2026;
/** Testerna kör i en värld där hela året redan är slut. */
const AFTER_YEAR = "2027-01-15";

function reset() {
  replaceDb(emptyTestDb({ fiscalYears: [calendarFiscalYear(FY)] }));
  db().settings.vatPeriodicity = "helar";
}

/** En verifikation som inte rör 1930, så bankavstämningen förblir ren. */
function bookSale(date: string, amount = 10_000) {
  postVerification({
    date,
    description: "Försäljning",
    entries: [
      { account: 1510, debit: amount * 1.25 },
      { account: 3001, credit: amount },
      { account: 2611, credit: amount * 0.25 },
    ],
    source: { type: "manuell" },
    createdBy: "anvandare",
  });
}

describe("periodstängningens ordning", () => {
  beforeEach(reset);

  it("månaderna som väntar är de avslutade och olåsta, äldst först", () => {
    const awaiting = monthsAwaitingClose(AFTER_YEAR);
    assert.equal(awaiting.length, 12, "hela 2026 är slut och inget är låst");
    assert.equal(awaiting[0].key, "2026-01");
    assert.equal(awaiting[11].key, "2026-12");
  });

  it("en pågående månad är inte att stänga, och en kommande inte heller", () => {
    const jan = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], "2026-01-20");
    assert.equal(jan.state, "pagaende");
    assert.ok(jan.blockers.some((b) => b.key === "manaden_slut"));

    const mars = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[2], "2026-01-20");
    assert.equal(mars.state, "kommande");
  });

  it("mars kan inte stängas medan februari står öppen – låset är ett enda datum", () => {
    bookSale("2026-01-15");
    bookSale("2026-03-10");
    assert.throws(() => closePeriod("2026-03"), (e: unknown) => {
      assert.ok(e instanceof PeriodCloseError);
      assert.match((e as Error).message, /januari 2026 måste stängas först/);
      return true;
    });
  });

  it("en stängd månad går inte att stänga igen", () => {
    bookSale("2026-01-15");
    closePeriod("2026-01");
    assert.throws(() => closePeriod("2026-01"), /redan stängd/);
  });

  it("en period utanför öppna räkenskapsår avvisas", () => {
    assert.throws(() => closePeriod("2025-11"), /hör inte till ett öppet räkenskapsår/);
  });
});

describe("periodstängningens kontroller", () => {
  beforeEach(reset);

  it("obokförda banktransaktioner i månaden blockerar", () => {
    bookSale("2026-01-15");
    db().bankTransactions.push({
      id: "tx-1",
      accountId: "acc-1",
      date: "2026-01-20",
      amount: -1_200,
      counterpart: "Clas Ohlson",
      description: "Kortköp",
      status: "ny",
    });
    const status = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], AFTER_YEAR);
    const bank = status.checks.find((c) => c.key === "bank")!;
    assert.equal(bank.ok, false);
    assert.match(bank.detail ?? "", /1 banktransaktion/);
    assert.throws(() => closePeriod("2026-01"), /kan inte stängas ännu/);
  });

  it("ett köp utan kvitto blockerar och namnger destinationen i länken", () => {
    bookSale("2026-01-15");
    db().expenses.push({
      id: "exp-1",
      supplier: "Clas Ohlson",
      date: "2026-01-18",
      amount: 499,
      vatAmount: 100,
      status: "saknar_kvitto",
      createdAt: "2026-01-18T09:00:00.000Z",
    });
    const status = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], AFTER_YEAR);
    const underlag = status.checks.find((c) => c.key === "underlag")!;
    assert.equal(underlag.ok, false);
    assert.match(underlag.detail ?? "", /1 köp saknar kvitto/);
    assert.equal(underlag.hrefLabel, "Öppna bokföringen");
  });

  it("ett fakturautkast upplyser men blockerar inte", () => {
    bookSale("2026-01-15");
    const status = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], AFTER_YEAR);
    const fakturor = status.checks.find((c) => c.key === "fakturor")!;
    assert.equal(fakturor.blocking, false);
  });

  it("månaden som avslutar momsperioden kräver att momsen är deklarerad", () => {
    bookSale("2026-12-10");
    const dec = monthsAwaitingClose(AFTER_YEAR).find((p) => p.key === "2026-12")!;
    const status = periodCloseStatus(dec, AFTER_YEAR);
    assert.equal(status.endsVatPeriod, true, "helårsmoms slutar samma dag som december");
    const moms = status.checks.find((c) => c.key === "moms")!;
    assert.equal(moms.ok, false);
    assert.equal(moms.blocking, true);
    assert.match(moms.detail ?? "", /Efter låset går underlaget inte att rätta/);
  });

  it("en månad utan momsperiod har ingen momskontroll", () => {
    const status = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], AFTER_YEAR);
    assert.equal(status.endsVatPeriod, false);
    assert.equal(status.checks.some((c) => c.key === "moms"), false);
  });

  it("utan anställd finns ingen lönekontroll", () => {
    const status = periodCloseStatus(monthsAwaitingClose(AFTER_YEAR)[0], AFTER_YEAR);
    assert.equal(status.checks.some((c) => c.key === "lon"), false);
  });
});

describe("stängningen låser och lämnar spår", () => {
  beforeEach(reset);

  it("låset flyttas till månadens sista dag och skrivs i loggen", () => {
    bookSale("2026-01-15", 20_000);
    const status = closePeriod("2026-01");

    assert.equal(status.state, "stangd");
    assert.equal(lockedThrough(), "2026-01-31");

    const entry = auditTrail({ action: "period_stangd" })[0];
    assert.ok(entry, "stängningen ska finnas i audit-loggen");
    assert.equal(entry.targetId, "2026-01");
    assert.match(entry.details, /januari 2026 stängdes/);
    assert.match(entry.details, /1 verifikation/);
    assert.match(entry.details, /låst till och med 2026-01-31/);
  });

  it("efter stängningen går månaden inte att bokföra i", () => {
    bookSale("2026-01-15");
    closePeriod("2026-01");
    assert.throws(() => bookSale("2026-01-20"), /låst/i);
  });

  it("nästa månad att stänga blir februari när januari är stängd", () => {
    bookSale("2026-01-15");
    bookSale("2026-02-15");
    closePeriod("2026-01");
    const next = nextMonthToClose(AFTER_YEAR);
    assert.equal(next?.period.key, "2026-02");
    assert.equal(next?.blockers.length, 0);
  });
});

describe("periodstängningen i åtgärdskön", () => {
  beforeEach(reset);

  it("en tom månad ger ingen rad – det finns inget att intyga", () => {
    const rows = listBookkeepingAttention().filter((a) => a.id.startsWith("period-close-"));
    assert.deepEqual(rows, []);
  });

  it("en avstämd månad med bokföring ger en rad som länkar till stängningen", () => {
    // Kön räknar med dagens datum, så månaden måste ligga bakom oss.
    const closable = monthsAwaitingClose();
    if (closable.length === 0) return; // året har inte hunnit få en avslutad månad
    bookSale(`${closable[0].key}-15`);

    const rows = listBookkeepingAttention().filter((a) => a.id.startsWith("period-close-"));
    assert.equal(rows.length, 1, "bara den äldsta olåsta månaden – låset är ett datum");
    assert.equal(rows[0].id, `period-close-${closable[0].key}`);
    assert.equal(rows[0].href, "/bokforing/periodstangning");
    assert.equal(controlsForAction(rows[0]).kind, "periodClose");
    assert.equal(issueForAction(rows[0]), "Stäng perioden");
  });
});

describe("myndigheternas datum för det avslutade året", () => {
  it("årsredovisningen ska in sju månader efter årets slut", () => {
    assert.equal(annualReportDueDate({ endDate: "2026-12-31" }), "2027-07-31");
    assert.equal(annualReportDueDate({ endDate: "2026-06-30" }), "2027-01-30");
    // 31 juli + 7 månader finns inte som 31 februari – dagen klampas.
    assert.equal(annualReportDueDate({ endDate: "2026-07-31" }), "2027-02-28");
  });

  it("inkomstdeklarationen följer Skatteverkets tabell för digital inlämning", () => {
    assert.equal(ink2DueDate({ endDate: "2026-12-31" }), "2027-08-01");
    assert.equal(ink2DueDate({ endDate: "2026-09-30" }), "2027-08-01");
    assert.equal(ink2DueDate({ endDate: "2026-04-30" }), "2026-12-01");
    assert.equal(ink2DueDate({ endDate: "2026-06-30" }), "2027-01-15");
    assert.equal(ink2DueDate({ endDate: "2026-08-31" }), "2027-04-01");
  });
});
