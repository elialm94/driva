process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  comparableProductKey,
  comparableUnitPriceOre,
  compareOffers,
  sameComparableProduct,
} from "./wholesalers/compare";
import { draftCartsBadge } from "./wholesalers/views";

describe("prisjämförelse", () => {
  it("16. samma namn men olika identifierare slås inte ihop", () => {
    const a = { name: "Kabel 5G2,5", articleNumber: "A-1", brand: "Nexans" };
    const b = { name: "Kabel 5G2,5", articleNumber: "B-9", brand: "Draka" };
    assert.equal(sameComparableProduct(a, b), false);
  });

  it("17. samma E-nummer jämförs med olika förpackningsstorlekar", () => {
    const keyA = comparableProductKey({ eNumber: "E1234567", articleNumber: "X" });
    const keyB = comparableProductKey({ eNumber: "E1234567", articleNumber: "Y" });
    assert.ok(keyA && keyB);
    assert.equal(keyA.key, keyB.key);
    const unitA = comparableUnitPriceOre({ netPriceOre: 4000, packSize: 4 });
    const unitB = comparableUnitPriceOre({ netPriceOre: 1800, packSize: 2 });
    assert.equal(unitA, 1000);
    assert.equal(unitB, 900);
    const cmp = compareOffers([
      { connectionId: "ahlsell", wholesalerLabel: "Ahlsell", productId: "p1", articleNumber: "X", unitPriceOre: unitA },
      { connectionId: "dahl", wholesalerLabel: "Dahl", productId: "p2", articleNumber: "Y", unitPriceOre: unitB },
    ]);
    assert.equal(cmp?.lowestConnectionId, "dahl");
  });

  it("varukorgsmärke när flera korgar finns", () => {
    const badge = draftCartsBadge(
      [
        {
          order: { connectionId: "a", status: "draft" } as never,
          lines: [{}, {}, {}] as never,
          totals: { lineCount: 3, missingCostCount: 0, missingCustomerPriceCount: 0 },
        },
        {
          order: { connectionId: "b", status: "draft" } as never,
          lines: [{}, {}] as never,
          totals: { lineCount: 2, missingCostCount: 0, missingCustomerPriceCount: 0 },
        },
      ],
      [
        { id: "a", label: "Ahlsell" },
        { id: "b", label: "Dahl" },
      ]
    );
    assert.equal(badge, "Ahlsell 3 · Dahl 2");
  });
});
