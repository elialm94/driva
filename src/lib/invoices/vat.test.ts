import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { docTotals, vatBreakdown } from "../calc";
import { labor } from "./test-db";

describe("VAT-motor (docTotals / vatBreakdown)", () => {
  it("räknar 25 % moms på hela kronor", () => {
    const t = docTotals([labor({ qty: 2, unitPrice: 550, vatRate: 25 })], null);
    assert.equal(t.subtotal, 1100);
    assert.equal(t.vat, 275);
    assert.equal(t.total, 1375);
    assert.equal(t.toPay, 1375);
  });

  it("summerar flera momssatser var för sig", () => {
    const lines = [
      labor({ id: "a", unitPrice: 1000, vatRate: 25 }),
      labor({ id: "b", unitPrice: 1000, vatRate: 12, kind: "material", description: "Virke" }),
      labor({ id: "c", unitPrice: 1000, vatRate: 6, kind: "material", description: "Böcker" }),
      labor({ id: "d", unitPrice: 1000, vatRate: 0, kind: "ovrigt", description: "Momsfritt" }),
    ];
    const t = docTotals(lines, null);
    assert.equal(t.subtotal, 4000);
    assert.equal(t.vat, 250 + 120 + 60);
    assert.equal(t.total, 4430);
    const vat = vatBreakdown(lines);
    assert.deepEqual(
      vat.map((v) => [v.rate, v.base, v.vat]),
      [
        [25, 1000, 250],
        [12, 1000, 120],
        [6, 1000, 60],
        [0, 1000, 0],
      ]
    );
  });

  it("0-kr-rad bidrar med 0 till delsumma och moms", () => {
    const lines = [
      labor({ id: "paid", qty: 1, unitPrice: 1000, vatRate: 25 }),
      labor({ id: "free", description: "Städning", qty: 1, unitPrice: 0, vatRate: 25 }),
    ];
    const t = docTotals(lines, null);
    assert.equal(t.subtotal, 1000);
    assert.equal(t.vat, 250);
    assert.equal(t.total, 1250);
  });

  it("behandlar negativt à-pris som rabatt i samma motor", () => {
    const lines = [
      labor({ id: "a", unitPrice: 2000, vatRate: 25 }),
      labor({ id: "b", description: "Rabatt", unitPrice: -200, vatRate: 25 }),
    ];
    const t = docTotals(lines, null);
    assert.equal(t.subtotal, 1800);
    assert.equal(t.vat, 450);
    assert.equal(t.toPay, 2250);
  });
});
