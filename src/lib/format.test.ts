import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { datumTid, dagarTill, halsning, kr, veckodag } from "./format";

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

describe("minus noll i belopp", () => {
  it("kr nollställer negativ nolla", () => {
    assert.match(kr(0), /^0\s*kr$/);
    assert.match(kr(-0), /^0\s*kr$/);
    assert.doesNotMatch(kr(-0), /−/);
  });

  it("resultatrapporten och lönespecen prefixar inte minus utanför kr()", () => {
    const resultat = readFileSync(new URL("../app/(app)/bokforing/resultat/page.tsx", import.meta.url), "utf8");
    const lonespec = readFileSync(new URL("../app/(app)/bokforing/lon/[runId]/page.tsx", import.meta.url), "utf8");
    assert.doesNotMatch(resultat, /−\{kr\(/);
    assert.doesNotMatch(lonespec, /−\{kr\(/);
  });
});
