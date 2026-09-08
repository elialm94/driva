process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseBeslutJson } from "./tax-reduction-beslut";

describe("ROT-beslut JSON", () => {
  it("läser svenskt exportformat", () => {
    const p = parseBeslutJson(
      JSON.stringify({ beslut: { utfall: "Delvis godkänt", nekatBelopp: 3500, diarienummer: "SKV-1" } })
    );
    assert.equal(p.outcome, "delvis_godkant");
    assert.equal(p.deniedAmount, 3500);
    assert.equal(p.reference, "SKV-1");
  });

  it("läser engelska fältnamn", () => {
    const p = parseBeslutJson(JSON.stringify({ outcome: "approved", amount: 12000 }));
    assert.equal(p.outcome, "godkant");
    assert.equal(p.approvedAmount, 12000);
  });

  it("kastar på tom/ogiltig fil", () => {
    assert.throws(() => parseBeslutJson("nope"), /giltig JSON/);
    assert.throws(() => parseBeslutJson("{}"), /Hittade inget beslut/);
  });
});
