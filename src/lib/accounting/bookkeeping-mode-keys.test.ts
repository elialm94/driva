process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { simpleBookkeepingKeys } from "./bookkeeping-mode-keys";

describe("simpleBookkeepingKeys", () => {
  it("visar att göra, underlag, bank och skatt i enkelt läge", () => {
    assert.deepEqual(simpleBookkeepingKeys({ hasPayroll: false, showYearEnd: false }), [
      "oversikt",
      "underlag",
      "bank",
      "skatt",
    ]);
  });

  it("lägger till lön och bokslut när de behövs", () => {
    assert.deepEqual(simpleBookkeepingKeys({ hasPayroll: true, showYearEnd: true }), [
      "oversikt",
      "underlag",
      "bank",
      "skatt",
      "lon",
      "bokslut",
    ]);
  });
});
