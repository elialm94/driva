process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb } from "../invoices/test-db";
import { postVerification } from "./engine";
import {
  authorityCalendar,
  authorityCalendarIcs,
  fSkattDueDate,
  upcomingAuthorityEvents,
} from "./skatteverket-calendar";

const YEAR = 2025;
const TODAY = "2026-04-20";

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
  db().settings.fSkattPerMonth = 0;
}

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

describe("myndighetskalendern", () => {
  beforeEach(reset);

  it("F-skatt förfaller den 12:e, 17:e i januari och augusti", () => {
    assert.equal(fSkattDueDate("2026-04"), "2026-04-12");
    assert.equal(fSkattDueDate("2026-01"), "2026-01-17");
    assert.equal(fSkattDueDate("2026-08"), "2026-08-17");
  });

  it("visar momsperioder med belopp och rätt status", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    const events = upcomingAuthorityEvents(TODAY);
    const k1 = events.find((e) => e.id === `moms-${YEAR}-K1`);
    assert.ok(k1, "K1 finns");
    assert.equal(k1.status, "forfallen");
    assert.equal(k1.amount, 2_500);
    assert.equal(k1.href, `/bokforing/moms?fokus=${YEAR}-K1`);
  });

  it("F-skatt syns bara när beloppet är satt, AGI bara när det finns anställda", () => {
    assert.equal(
      upcomingAuthorityEvents(TODAY).filter((e) => e.kind === "f_skatt" || e.kind === "agi").length,
      0
    );
    db().settings.fSkattPerMonth = 12_400;
    const withTax = upcomingAuthorityEvents(TODAY);
    assert.ok(withTax.some((e) => e.kind === "f_skatt" && e.amount === 12_400));
    assert.ok(!withTax.some((e) => e.kind === "agi"));
  });

  it("INK2 och årsredovisning följer räkenskapsårets slut", () => {
    const events = authorityCalendar(TODAY, 400);
    const ink2 = events.find((e) => e.kind === "ink2");
    const ars = events.find((e) => e.kind === "arsredovisning");
    assert.equal(ink2?.dueDate, "2026-08-01");
    assert.equal(ars?.dueDate, "2026-07-31");
  });

  it("ICS innehåller en VEVENT per öppen post och en stabil UID", () => {
    bookSales(`${YEAR}-02-10`, 10_000, 2_500);
    db().settings.fSkattPerMonth = 3_000;
    const ics = authorityCalendarIcs({ today: TODAY, companyName: "Test Snickeri AB", origin: "https://app.example" });
    assert.match(ics, /^BEGIN:VCALENDAR\r\n/);
    assert.match(ics, /X-WR-CALNAME:Skatteverket · Test Snickeri AB/);
    assert.match(ics, /UID:moms-2025-K1@driva/);
    assert.match(ics, /SUMMARY:Moms/);
    assert.match(ics, /URL:https:\/\/app\.example\/bokforing\/moms\?fokus=2025-K1/);
    assert.match(ics, /END:VCALENDAR\r\n$/);
    assert.ok(!ics.includes("STATUS:klar") && !ics.includes("BEGIN:VEVENT\r\nUID:moms-2025-K1@driva") === false);
  });
});
