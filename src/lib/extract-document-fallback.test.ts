process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hintFromModelJson } from "./ai/extract-document";

describe("AI-dokumenttolkning faller tillbaka", () => {
  it("20. trasig eller tom modelloutput ger manuell granskning, inte påhittade rader", () => {
    assert.equal(hintFromModelJson(null), undefined);
    assert.equal(hintFromModelJson("inte json {"), undefined);
    assert.equal(hintFromModelJson("```json\nnej\n```"), undefined);
    assert.equal(hintFromModelJson(JSON.stringify({ lines: [{ inventerat: true }] })), undefined);

    const hint = hintFromModelJson(
      JSON.stringify({
        amount: 100,
        vatAmount: 20,
        supplier: "Byggmax",
        lines: [
          { name: "Skruv", qty: 1, lineAmount: 100 },
          { foo: "påhittad" },
        ],
      })
    );
    assert.ok(hint);
    assert.equal(hint.amount, 100);
    assert.equal(hint.lines?.length, 1);
    assert.equal(hint.lines?.[0]?.name, "Skruv");
  });
});
