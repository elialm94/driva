import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datumTid, dagarTill, halsning, kr, veckodag } from "./format";

describe("kr: noll är noll, aldrig minus noll", () => {
  /*
   * Math.round(-0.4) är -0, och Intl formaterar -0 med minustecken. Ett belopp
   * som är noll ska läsas som "0 kr" – "−0 kr" ser ut som ett fel i bokföringen.
   */
  it("kr(-0) visar inte ett minustecken", () => {
    assert.equal(kr(-0), kr(0));
    assert.equal(kr(-0), "0\u00a0kr");
  });

  it("ett negativt belopp som rundas till noll visar inte minus", () => {
    assert.equal(kr(-0.4), "0\u00a0kr");
    assert.equal(kr(-0.2), "0\u00a0kr");
  });

  it("riktiga negativa belopp behåller sitt minustecken", () => {
    assert.equal(kr(-1), "\u22121\u00a0kr");
    assert.equal(kr(-25000), "\u221225\u00a0000\u00a0kr");
  });

  it("noll och positiva belopp är oförändrade", () => {
    assert.equal(kr(0), "0\u00a0kr");
    assert.equal(kr(4000), "4\u00a0000\u00a0kr");
  });
});

describe("halsning: svensk klocka, inte serverns UTC", () => {
  it("06:22 sommartid (04:22 UTC) är God morgon, inte God natt", () => {
    // Skärmdumpen: tisdag 1 sept 2026 kl 06:22 i Sverige = 04:22 UTC.
    assert.equal(halsning(new Date("2026-09-01T04:22:00.000Z")), "God morgon");
  });

  it("04:59 sommartid är fortfarande God natt", () => {
    assert.equal(halsning(new Date("2026-09-01T02:59:00.000Z")), "God natt");
  });

  it("05:00 sommartid är God morgon", () => {
    assert.equal(halsning(new Date("2026-09-01T03:00:00.000Z")), "God morgon");
  });

  it("06:22 vintertid (05:22 UTC) är God morgon", () => {
    assert.equal(halsning(new Date("2026-01-15T05:22:00.000Z")), "God morgon");
  });

  it("10:00 svensk tid är God förmiddag", () => {
    assert.equal(halsning(new Date("2026-09-01T08:00:00.000Z")), "God förmiddag");
  });

  it("18:00 svensk tid är God kväll", () => {
    assert.equal(halsning(new Date("2026-09-01T16:00:00.000Z")), "God kväll");
  });
});

describe("datumvisning i Europe/Stockholm", () => {
  it("veckodag vid svensk morgon följer svensk kalender", () => {
    assert.equal(veckodag("2026-09-01T04:22:00.000Z"), "Tisdag");
  });

  it("klockslag i datumTid är svensk tid", () => {
    assert.match(datumTid("2026-09-01T04:22:00.000Z"), /06:22/);
  });
});

describe("dagarTill räknar svenska kalenderdagar", () => {
  it("just efter svensk midnatt är samma dag, inte föregående UTC-dygn", () => {
    const justAfterMidnightCest = new Date("2026-08-31T22:30:00.000Z"); // 00:30 1 sept
    assert.equal(dagarTill("2026-09-01T04:22:00.000Z", justAfterMidnightCest), 0);
  });
});
