import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { highlightFromAtgard } from "./economy-atgard";

describe("?atgard= → markerad rad i Ekonomi", () => {
  it("bank-<id> markerar transaktionen på bankfliken", () => {
    assert.equal(highlightFromAtgard("bank-tx-1", "bank"), "tx-1");
    assert.equal(highlightFromAtgard("bank-unexplained", "bank"), undefined);
    assert.equal(highlightFromAtgard("bank-tx-1", "utgifter"), undefined);
  });
  it("question-/receipt-/supplier- markerar utgiften", () => {
    assert.equal(highlightFromAtgard("question-exp-1", "utgifter"), "exp-1");
    assert.equal(highlightFromAtgard("receipt-exp-2", "utgifter"), "exp-2");
    assert.equal(highlightFromAtgard("supplier-si-3", "utgifter"), "si-3");
    assert.equal(highlightFromAtgard("receipt-", "utgifter"), undefined);
  });
  it("tom eller okänd åtgärd markerar ingenting", () => {
    assert.equal(highlightFromAtgard(undefined, "bank"), undefined);
    assert.equal(highlightFromAtgard("   ", "utgifter"), undefined);
    assert.equal(highlightFromAtgard("vat-2026-K2", "offerter"), undefined);
  });
});
