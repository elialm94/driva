/**
 * Traktamente som reseräkning: avresa och hemkomst med klockslag, fri kost
 * och land.
 *
 * Innan: schablonen räknades bara på tre räknare (hela dagar, halva dagar,
 * nätter). Två fel följde av det. Fri kost minskade inte schablonen, så en
 * resa där kunden bjöd på både lunch och middag betalades ut med hela
 * dagbeloppet skattefritt - det överskjutande är lön. Och landet fanns inte
 * med, så en resa till Norge fick tysta svenska 300 kr i stället för
 * Skatteverkets normalbelopp för landet.
 *
 * Nu räknas hel dag, halv dag och natt fram ur datumtiderna (hel avresedag
 * före kl 12, hel hemkomstdag efter kl 19, natt per dygnsbyte), fri kost
 * minskar dagbeloppet enligt Skatteverkets procentsatser, och utlandsresor
 * måste hämta normalbelopp ur tabellen - finns landet inte där får ingen
 * schablon gissas fram.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FOREIGN_PER_DIEM_RATES,
  FREE_MEALS_LABELS,
  foreignPerDiemRatesFor,
  freeMealsDeduction,
  perDiemAllowance,
  perDiemRatesFor,
  tripDays,
  type FreeMeals,
} from "./allowances";

describe("Fri kost minskar dagtraktamentet", () => {
  it("Skatteverkets procentsatser på 2026 års heldag (300 kr)", () => {
    const { heldag } = perDiemRatesFor(2026);
    assert.equal(heldag, 300);
    assert.equal(freeMealsDeduction(heldag, "inga"), 0);
    // 15 % frukost, 35 % lunch eller middag, 70 % båda, 85 % helt fri kost.
    assert.equal(freeMealsDeduction(heldag, "frukost"), 45);
    assert.equal(freeMealsDeduction(heldag, "lunch_eller_middag"), 105);
    assert.equal(freeMealsDeduction(heldag, "lunch_och_middag"), 210);
    assert.equal(freeMealsDeduction(heldag, "alla"), 255);
  });

  it("halv dag minskas på halvdagsbeloppet, natten aldrig", () => {
    const { halvdag, natt } = perDiemRatesFor(2026);
    assert.equal(halvdag, 150);
    assert.equal(freeMealsDeduction(halvdag, "alla"), 128);
    // En natt utan logi ersätts oavsett måltider - kosten hör till dagen.
    assert.equal(perDiemAllowance({ date: "2026-03-10", fullDays: 0, halfDays: 0, nights: 2, freeMeals: "alla" }), 2 * natt);
  });

  it("en resa med fri lunch och middag betalas ut med 30 % av dagbeloppet", () => {
    const full = perDiemAllowance({ date: "2026-03-10", fullDays: 2, halfDays: 0, nights: 1 });
    assert.equal(full, 2 * 300 + 150);
    const reduced = perDiemAllowance({
      date: "2026-03-10",
      fullDays: 2,
      halfDays: 0,
      nights: 1,
      freeMeals: "lunch_och_middag",
    });
    // 2 × (300 − 210) + 150 = 330 kr skattefritt, inte 750 kr.
    assert.equal(reduced, 2 * 90 + 150);
    assert.ok(reduced < full, "fri kost får aldrig ge samma belopp som ingen kost");
  });

  it("varje nivå har en svensk etikett och kan aldrig ge negativt traktamente", () => {
    const levels: FreeMeals[] = ["inga", "frukost", "lunch_eller_middag", "lunch_och_middag", "alla"];
    for (const level of levels) {
      assert.equal(typeof FREE_MEALS_LABELS[level], "string");
      assert.ok(FREE_MEALS_LABELS[level].length > 0);
      assert.ok(freeMealsDeduction(300, level) <= 300);
    }
    assert.equal(perDiemAllowance({ date: "2026-03-10", fullDays: 1, halfDays: 0, nights: 0, freeMeals: "alla" }), 45);
  });
});

describe("Hel dag, halv dag och natt ur avresa och hemkomst", () => {
  it("avresa före kl 12 och hemkomst efter kl 19 är hela dagar", () => {
    assert.deepEqual(tripDays("2026-03-10T07:00", "2026-03-12T20:30"), { fullDays: 3, halfDays: 0, nights: 2 });
    assert.deepEqual(tripDays("2026-03-10T08:00", "2026-03-11T20:00"), { fullDays: 2, halfDays: 0, nights: 1 });
  });

  it("avresa efter kl 12 och hemkomst före kl 19 är halva dagar", () => {
    assert.deepEqual(tripDays("2026-03-10T13:00", "2026-03-11T17:00"), { fullDays: 0, halfDays: 2, nights: 1 });
    // Mellandagar är alltid hela dagar.
    assert.deepEqual(tripDays("2026-03-10T14:00", "2026-03-13T09:00"), { fullDays: 2, halfDays: 2, nights: 3 });
  });

  it("gränserna kl 12.00 och 19.00 räknas som halv dag", () => {
    assert.deepEqual(tripDays("2026-03-10T12:00", "2026-03-11T19:00"), { fullDays: 0, halfDays: 2, nights: 1 });
    assert.deepEqual(tripDays("2026-03-10T11:59", "2026-03-11T19:01"), { fullDays: 2, halfDays: 0, nights: 1 });
  });

  it("nätterna är dygnsbytena - en resa inom samma dygn ger inget traktamente", () => {
    assert.equal(tripDays("2026-03-10T06:00", "2026-03-10T23:59"), null);
    assert.equal(tripDays("2026-03-10T22:00", "2026-03-11T05:00")?.nights, 1);
    assert.equal(tripDays("2026-03-12T08:00", "2026-03-10T08:00"), null);
    assert.equal(tripDays("", "2026-03-10T08:00"), null);
    assert.equal(tripDays("2026-03-10", "2026-03-11T08:00"), null);
  });

  it("dagarna ur tiderna räknas med samma schablon som räknarna", () => {
    const days = tripDays("2026-03-10T07:00", "2026-03-11T17:00");
    assert.deepEqual(days, { fullDays: 1, halfDays: 1, nights: 1 });
    assert.equal(perDiemAllowance({ date: "2026-03-10", ...days! }), 300 + 150 + 150);
  });
});

describe("Utlandsresor får inte gissa den svenska schablonen", () => {
  it("normalbeloppstabellen är tom tills Skatteverkets landlista finns i repot", () => {
    assert.deepEqual(FOREIGN_PER_DIEM_RATES, {});
    assert.equal(foreignPerDiemRatesFor("NO", 2026), undefined);
    assert.equal(foreignPerDiemRatesFor("no", 2026), undefined);
    assert.equal(foreignPerDiemRatesFor("DK", 2026), undefined);
  });

  it("ett land i tabellen slår igenom - och aldrig det svenska beloppet", () => {
    const table: Record<string, Record<number, { heldag: number; halvdag: number; natt: number }>> = {
      NO: { 2026: { heldag: 1_010, halvdag: 505, natt: 505 } },
    };
    const rates = foreignPerDiemRatesFor("NO", 2026, table);
    assert.deepEqual(rates, { heldag: 1_010, halvdag: 505, natt: 505 });
    assert.notEqual(rates?.heldag, perDiemRatesFor(2026).heldag);
    // Okänt år i tabellen ger inget - ett gammalt normalbelopp är inte årets.
    assert.equal(foreignPerDiemRatesFor("NO", 2030, table), undefined);
    assert.equal(
      perDiemAllowance({ date: "2026-03-10", fullDays: 1, halfDays: 0, nights: 1, rates: rates! }),
      1_010 + 505
    );
  });
});
