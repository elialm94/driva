process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isTaxReductionEligible } from "./economic-line-type";

describe("ROT/RUT och material", () => {
  it("22. ROT/RUT-underlaget exkluderar material", () => {
    assert.equal(isTaxReductionEligible("MATERIAL", "rot"), false);
    assert.equal(isTaxReductionEligible("MATERIAL", "rut"), false);
    assert.equal(isTaxReductionEligible("LABOR", "rot"), true);
  });
});
