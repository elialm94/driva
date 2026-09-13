process.env.DRIVA_TEST = "1";

/**
 * Representation har EN motor: `representationSplit`.
 *
 * Innan: samma restaurangnota fick två olika konteringar. Ny utgift →
 * Representation frågade efter antal personer och alkohol och delade upp
 * notan i avdragsgill kostnad (6071/7631), ej avdragsgill kostnad
 * (6072/7632) och avdragsgill moms enligt schablonen. En bankhändelse som
 * kategoriserades som Kundrepresentation bokfördes i stället platt på 6072
 * med generiskt momsavdrag - ingen fråga om personer, ingen fråga om
 * alkohol, 6071 aldrig använt.
 *
 * Nu går båda vägarna genom samma motor, och bankvägen frågar efter de två
 * uppgifter som inte går att härleda ur en transaktion innan något bokförs.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { entriesExpense } from "./bas";

/* ------------------------- Den platta vägen är stängd ------------------------- */

describe("Kundrepresentation kan inte konteras generiskt", () => {
  it("entriesExpense vägrar kontera kategorin - avdraget kräver uppgifter den inte har", () => {
    assert.throws(
      () => entriesExpense("representation", 1_500, 161, 1930),
      /antal personer/,
      "en restaurangnota får aldrig bokföras platt på 6072"
    );
  });
});
