process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocationOverflow, validateDocumentLineMath } from "./document-line-math";

const sevenArticles = [
  { name: "Skruv 4,5", qty: 1, unitPrice: 89, lineAmount: 89 },
  { name: "Regel 45x70", qty: 8, unitPrice: 42, lineAmount: 336 },
  { name: "Skiva", qty: 2, unitPrice: 249, lineAmount: 498 },
  { name: "Vinkelbeslag", qty: 10, unitPrice: 12, lineAmount: 120 },
  { name: "Trallskruv", qty: 1, unitPrice: 79, lineAmount: 79 },
  { name: "Fog", qty: 1, unitPrice: 65, lineAmount: 65 },
  { name: "Pensel", qty: 1, unitPrice: 61, lineAmount: 61 },
];

describe("dokumentradsmatematik", () => {
  it("1. sju tydliga artikelrader och summan stämmer", () => {
    const math = validateDocumentLineMath({ lines: sevenArticles, documentTotal: 1248 });
    assert.equal(math.ok, true);
    assert.equal(math.articleCount, 7);
    assert.equal(math.lineSum, 1248);
    assert.match(math.message, /7 varor/);
  });

  it("4. en artikelrad är oläslig", () => {
    const math = validateDocumentLineMath({
      lines: [...sevenArticles.slice(0, 6), { unreadable: true }],
      documentTotal: 1248,
    });
    assert.equal(math.ok, false);
    assert.equal(math.unreadableCount, 1);
    assert.match(math.message, /En rad/);
  });

  it("5. radsumman skiljer sig från kvittots totalsumma", () => {
    const math = validateDocumentLineMath({ lines: sevenArticles, documentTotal: 1300 });
    assert.equal(math.ok, false);
    assert.equal(Math.abs(math.delta), 52);
    assert.match(math.message, /1[\s\u00a0]248/);
  });

  it("6. rabatt, pant, frakt och avrundning", () => {
    const math = validateDocumentLineMath({
      lines: [
        { qty: 1, lineAmount: 1000 },
        { role: "freight", lineAmount: 99 },
        { role: "deposit", lineAmount: 40 },
        { role: "rounding", lineAmount: -1 },
        { discount: 50, qty: 1, unitPrice: 50, lineAmount: 0 },
      ],
      documentTotal: 1138,
    });
    assert.equal(math.ok, true);
    assert.equal(math.extras.freight, 99);
    assert.equal(math.extras.deposit, 40);
    assert.equal(math.extras.rounding, -1);
  });

  it("7. retur/negativ rad", () => {
    const math = validateDocumentLineMath({
      lines: [
        { lineAmount: 200 },
        { role: "return", lineAmount: -50 },
      ],
      documentTotal: 150,
    });
    assert.equal(math.ok, true);
    assert.equal(math.hasReturn, true);
  });

  it("allokeringar får inte överstiga antal eller belopp", () => {
    const overflow = allocationOverflow({
      lineQty: 2,
      lineAmount: 200,
      allocations: [
        { qty: 1.5, amountExclVat: 150 },
        { qty: 1, amountExclVat: 100 },
      ],
    });
    assert.equal(overflow.qtyOk, false);
    assert.equal(overflow.amountOk, false);
  });
});
