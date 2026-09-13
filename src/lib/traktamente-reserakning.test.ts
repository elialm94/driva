process.env.DRIVA_TEST = "1";

/**
 * Traktamente = Skatteverkets reseräkning.
 *
 * Innan: formuläret frågade efter resmål i fri text, tre räknare (hela dagar,
 * halva dagar, nätter) och erbjöd en kvittoruta. Klockslag fanns inte, så
 * hel/halv dag var användarens gissning; fri kost minskade inte schablonen;
 * och ett utländskt resmål bokfördes tyst med det svenska beloppet. Under
 * fälten låg hela uppsatsen om 2893 och ruta 050 alltid utfälld.
 *
 * Nu är fälten blankettens: vem (den inloggade), resmål ur Places (ort eller
 * gata, vilket land som helst), avresa och hemkomst med klockslag, anledning,
 * fri kost, land och 50 km-villkoret. Dagarna räknas ur tiderna, fri kost
 * minskar dagbeloppet, ett land utan normalbelopp blockerar sparningen och
 * kvittorutan är borta - schablonen är underlaget.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import {
  perDiemTripDays,
  perDiemTripRates,
  planIsBalanced,
  planManualExpense,
  type ManualExpenseDraft,
} from "./expenses/manual-expense";
import { perDiemRatesFor } from "./accounting/allowances";
import {
  ADDRESS_PRIMARY_TYPES,
  ADDRESS_REGION_CODES,
  TRIP_PRIMARY_TYPES,
  TRIP_REGION_CODES,
  demoTripSuggestions,
  formatTripDestination,
  partsFromPlaceComponents,
} from "./address-autocomplete";
import { createManualExpense } from "./services/manual-expense";
import { expenseEntries } from "./services/expenses";
import { todayDate, previousDay } from "./accounting/dates";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const TODAY = todayDate();
const YEAR = Number(TODAY.slice(0, 4));

/** Svensk formattering använder hårda blanksteg (1 050 kr). */
function plain(text: string | undefined): string {
  return (text ?? "").replace(/\u00a0/g, " ");
}

function net(lines: readonly { account: number; debit: number; credit: number }[]) {
  const out: Record<number, number> = {};
  for (const l of lines) out[l.account] = (out[l.account] ?? 0) + l.debit - l.credit;
  return out;
}

/** En reseräkning: Göteborg, avresa 07.00 och hemkomst 17.00 dagen efter. */
function trip(over: Partial<NonNullable<ManualExpenseDraft["perDiem"]>> = {}, date = "2026-03-10"): ManualExpenseDraft {
  return {
    kind: "traktamente",
    date,
    paidBy: "privat",
    perDiem: {
      fullDays: 0,
      halfDays: 0,
      nights: 0,
      destination: "Göteborg",
      departure: `${date}T07:00`,
      arrival: "2026-03-11T17:00",
      countryCode: "SE",
      countryName: "Sverige",
      ...over,
    },
  };
}

function plan(draft: ManualExpenseDraft) {
  const result = planManualExpense(draft);
  assert.ok(result.ok, result.ok ? "" : result.error);
  assert.ok(planIsBalanced(result.plan), "planen är i balans");
  return result.plan;
}

function planError(draft: ManualExpenseDraft): string {
  const result = planManualExpense(draft);
  assert.ok(!result.ok, "planen skulle ha nekats");
  return result.error;
}

describe("Reseräkningen räknar dagarna ur avresa och hemkomst", () => {
  it("en övernattning i Göteborg: hel avresedag, halv hemkomstdag och en natt", () => {
    const p = plan(trip());
    assert.deepEqual(perDiemTripDays(trip().perDiem!), { fullDays: 1, halfDays: 1, nights: 1 });
    assert.equal(p.amount, 300 + 150 + 150);
    assert.deepEqual(net(p.lines), { 7321: 600, 2893: -600 });
    assert.equal(p.vatDeductible, 0);
    assert.match(plain(p.explanation), /Avresa 2026-03-10 07:00 och hemkomst 2026-03-11 17:00/);
  });

  it("utan klockslag går resan inte att spara - övernattningen är villkoret", () => {
    assert.match(
      planError(trip({ departure: "2026-03-10T07:00", arrival: "2026-03-10T23:00" })),
      /traktamente kräver övernattning/
    );
    assert.match(planError(trip({ departure: "2026-03-10T07:00", arrival: "" })), /Fyll i avresa och hemkomst/);
    assert.match(planError(trip({ departure: "", arrival: "2026-03-11T17:00" })), /Fyll i avresa och hemkomst/);
  });

  it("fri logi tar bort nattraktamentet men behåller dagarna", () => {
    const p = plan(trip({ paidLodging: true }));
    assert.equal(p.amount, 300 + 150);
    assert.match(plain(p.explanation), /Bolaget betalade login/);
  });

  it("anledningen står på verifikationen och i beskrivningen", () => {
    const p = plan(trip({ reason: "Montage hos Bergs Bygg" }));
    assert.equal(p.description, "Göteborg, 1 heldag, 1 halvdag, 1 natt - Montage hos Bergs Bygg");
    assert.match(p.explanation, /Anledning: Montage hos Bergs Bygg\./);
  });

  it("resmålet är fortfarande obligatoriskt", () => {
    assert.equal(planError(trip({ destination: "" })), "Skriv vart resan gick.");
  });
});

describe("Fri kost minskar det skattefria beloppet", () => {
  it("lunch och middag: 30 % av dagbeloppet betalas ut, natten oförändrad", () => {
    const p = plan(trip({ freeMeals: "lunch_och_middag" }));
    // Heldag 300 − 210 = 90, halvdag 150 − 105 = 45, natt 150.
    assert.equal(p.amount, 90 + 45 + 150);
    assert.match(plain(p.explanation), /Fri kost \(lunch och middag\) minskar schablonen med 210 kr per heldag/);
  });

  it("alla måltider fria och fri logi ger för lite att betala ut", () => {
    // Heldag 300 − 255 = 45, halvdag 150 − 128 = 22, ingen natt.
    const p = plan(trip({ freeMeals: "alla" }));
    assert.equal(p.amount, 45 + 22 + 150);
    assert.equal(plan(trip({ freeMeals: "inga" })).amount, 600);
  });
});

describe("Utlandsresa får inte bokföras med svensk schablon", () => {
  it("Norge blockeras med Skatteverkets normalbelopp som orsak", () => {
    const norway = trip({ destination: "Oslo, Norge", countryCode: "NO", countryName: "Norge" });
    assert.equal(planError(norway), "Utland - saknar schablon för Norge");
    // Inget silent fallback: det svenska beloppet finns inte i svaret.
    assert.equal(perDiemTripRates("2026-03-10", norway.perDiem).ok, false);
    assert.deepEqual(perDiemTripRates("2026-03-10", trip().perDiem), { ok: true, rates: perDiemRatesFor(2026) });
  });

  it("okänt land utan namn ber om landet i stället för att gissa", () => {
    assert.equal(
      planError(trip({ destination: "Kirkenes", countryCode: "ZZ", countryName: "" })),
      "Skriv vilket land resan gick till."
    );
  });

  it("tom landskod är Sverige - gamla resor utan land räknas som inrikes", () => {
    assert.equal(plan(trip({ countryCode: "", countryName: "" })).amount, 600);
  });
});

describe("Reseräkningen bokförs och kan bokföras om till exakt samma verifikation", () => {
  beforeEach(() => {
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
  });

  it("en resa utan kvitto bokförs på 7321 mot 2893 och sparar tiderna", () => {
    const departure = `${previousDay(TODAY)}T07:00`;
    const arrival = `${TODAY}T17:00`;
    const rates = perDiemRatesFor(YEAR);
    const result = createManualExpense({
      kind: "traktamente",
      date: previousDay(TODAY),
      paidBy: "privat",
      perDiem: {
        fullDays: 0,
        halfDays: 0,
        nights: 0,
        destination: "Göteborg",
        departure,
        arrival,
        freeMeals: "inga",
        countryCode: "SE",
        countryName: "Sverige",
        reason: "Montage hos kund",
      },
    });
    assert.ok(result.verificationId, "resan bokfördes direkt");
    assert.equal(result.expense.receiptId, undefined, "inget kvitto krävs");
    assert.equal(result.expense.amount, rates.heldag + rates.halvdag + rates.natt);
    assert.deepEqual(result.expense.details?.perDiem, {
      fullDays: 1,
      halfDays: 1,
      nights: 1,
      destination: "Göteborg",
      departure,
      arrival,
      reason: "Montage hos kund",
      rates,
    });

    // Ombokning ur de sparade uppgifterna ger samma kontering och samma text.
    const replayed = expenseEntries(result.expense, "traktamente");
    const booked = db().verifications.find((v) => v.id === result.verificationId);
    assert.ok(booked);
    assert.deepEqual(
      replayed.entries.map((e) => [e.account, e.debit, e.credit]),
      booked.entries.map((e) => [e.account, e.debit, e.credit])
    );
    assert.equal(replayed.explanation, booked.explanation);
    assert.match(booked.explanation ?? "", /7321/);
    assert.match(booked.explanation ?? "", /2893/);
  });

  it("fri kost och fri logi följer med till bokföringen", () => {
    const result = createManualExpense({
      kind: "traktamente",
      date: previousDay(TODAY),
      paidBy: "privat",
      perDiem: {
        fullDays: 0,
        halfDays: 0,
        nights: 0,
        destination: "Kiruna",
        departure: `${previousDay(TODAY)}T06:00`,
        arrival: `${TODAY}T20:00`,
        freeMeals: "frukost",
        paidLodging: true,
      },
    });
    const rates = perDiemRatesFor(YEAR);
    const perHeldag = rates.heldag - Math.round(rates.heldag * 0.15);
    assert.equal(result.expense.amount, 2 * perHeldag);
    assert.equal(result.expense.details?.perDiem?.freeMeals, "frukost");
    assert.equal(result.expense.details?.perDiem?.paidLodging, true);
    assert.equal(result.expense.details?.perDiem?.nights, 0);
  });
});

describe("Resmålet kommer ur den delade adresskomponenten", () => {
  it("resmål söker orter i hela världen, adressfälten är kvar på svenska adresser", () => {
    assert.deepEqual([...TRIP_PRIMARY_TYPES], ["geocode"]);
    assert.deepEqual([...TRIP_REGION_CODES], []);
    assert.deepEqual([...ADDRESS_PRIMARY_TYPES], ["premise", "subpremise", "street_address", "route"]);
    assert.deepEqual([...ADDRESS_REGION_CODES], ["se"]);
    const source = readFileSync(join(root, "src/components/address-input.tsx"), "utf8");
    assert.match(source, /if \(regionCodes\.length\) request\.includedRegionCodes = \[\.\.\.regionCodes\];/);
    assert.match(source, /else delete request\.includedRegionCodes;/);
  });

  it("landet följer med ett Places-svar utan att röra de gamla adressfälten", () => {
    assert.deepEqual(
      partsFromPlaceComponents([
        { longText: "Oslo", types: ["locality"] },
        { longText: "Norge", shortText: "NO", types: ["country"] },
      ]),
      { address: "", postalCode: "", city: "Oslo", country: "Norge", countryCode: "NO" }
    );
    // Utan land i svaret ser objektet ut precis som förut - inga tomma nycklar.
    assert.deepEqual(partsFromPlaceComponents([{ longText: "Vasagatan", types: ["route"] }]), {
      address: "Vasagatan",
      postalCode: "",
      city: "",
    });
  });

  it("resmålet skrivs som en rad utan att upprepa orten, och utan Sverige", () => {
    assert.equal(
      formatTripDestination({ address: "Göteborg", postalCode: "", city: "Göteborg", country: "Sverige", countryCode: "SE" }),
      "Göteborg"
    );
    assert.equal(
      formatTripDestination({ address: "Oslo", postalCode: "", city: "Oslo", country: "Norge", countryCode: "NO" }),
      "Oslo, Norge"
    );
    assert.equal(
      formatTripDestination({ address: "Vasagatan 33", postalCode: "411 24", city: "Göteborg", countryCode: "SE" }),
      "Vasagatan 33, 411 24 Göteborg"
    );
  });

  it("utan Google-nyckel finns exempelorter med land, så utlandsfallet går att välja", () => {
    assert.deepEqual(demoTripSuggestions("gö")[0], undefined, "under tre tecken söks inget");
    const gbg = demoTripSuggestions("göteborg");
    assert.equal(gbg[0]?.city, "Göteborg");
    assert.equal(gbg[0]?.countryCode, "SE");
    const oslo = demoTripSuggestions("oslo");
    assert.equal(oslo[0]?.country, "Norge");
    assert.equal(oslo[0]?.countryCode, "NO");
  });
});

describe("Formuläret för traktamente är reseräkningens fält", () => {
  const source = readFileSync(join(root, "src/components/manual-expense-form.tsx"), "utf8");

  it("återanvänder den delade Places-komponenten för resmålet", () => {
    assert.match(source, /from ["']\.\/address-input["']/);
    assert.match(source, /<AddressAutocomplete[\s\S]*id="traktamente-resmal"/);
    assert.match(source, /composeSelected="trip"/);
    assert.match(source, /primaryTypes=\{TRIP_PRIMARY_TYPES\}/);
    assert.match(source, /regionCodes=\{TRIP_REGION_CODES\}/);
  });

  it("har vem, tider, anledning, fri kost, land och 50 km-villkoret", () => {
    assert.match(source, /data-traktamente-vem/);
    assert.match(source, /travellerName/);
    assert.match(source, /id="traktamente-avresetid"[\s\S]*?type="time"|type="time"[\s\S]*?id="traktamente-avresetid"/);
    assert.match(source, /id="traktamente-hemkomsttid"/);
    assert.match(source, /id="traktamente-anledning"/);
    assert.match(source, /id="traktamente-frikost"/);
    assert.match(source, /id="traktamente-land"/);
    assert.match(source, /id="traktamente-50km"/);
    assert.match(source, /mer än 50 km från både bostaden och den vanliga arbetsplatsen/);
  });

  it("har ingen kvittoruta och ingen alltid synlig uppsats om 2893 och ruta 050", () => {
    // Kvittorutan och 2893-bannern renderas bara för de andra slagen.
    assert.match(source, /kind === "traktamente" \? null : \(\s*<Card className="p-5">\s*<span className=\{labelCls\}>\s*Kvitto/);
    assert.match(source, /\) : kind === "milersattning" \? \(\s*<p className="rounded-xl bg-ink\/4/);
    assert.doesNotMatch(source, /ruta 050/);
    assert.match(source, /Hur bokförs det\? Skattefritt traktamente \(7321\) mot skuld till dig \(2893\), ingen moms\./);
  });

  it("har inga räknare kvar för hela dagar, halva dagar och nätter", () => {
    assert.doesNotMatch(source, /label="Hela dagar"/);
    assert.doesNotMatch(source, /label="Halva dagar"/);
    assert.doesNotMatch(source, /label="Nätter utan betald logi"/);
  });

  it("resmålet förifylls från uppdragets adress", () => {
    assert.match(source, /selectedJob\?\.address/);
    assert.match(source, /tripDestination/);
  });
});
