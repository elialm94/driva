process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { materialPriceWarnings, resolveMaterialCustomerPrice } from "./material-price";

describe("kundpris-hierarki", () => {
  it("13. explicit pris vinner, saknat pris blockerar nollkronor", () => {
    const explicit = resolveMaterialCustomerPrice({
      explicitKronor: 199,
      jobRule: { kind: "markup", percent: 35 },
      unitCostOre: 10000,
    });
    assert.equal(explicit.kronor, 199);
    assert.equal(explicit.source, "explicit");

    const job = resolveMaterialCustomerPrice({
      jobRule: { kind: "markup", percent: 35 },
      unitCostOre: 10000,
    });
    assert.equal(job.source, "job");
    assert.ok(job.kronor && job.kronor > 100);

    const missing = resolveMaterialCustomerPrice({
      customerRule: { kind: "later" },
    });
    assert.equal(missing.source, "missing");
    const warns = materialPriceWarnings({ customerPriceKronor: undefined, unitCostKronor: 80 });
    assert.ok(warns.some((w) => w.kind === "missing_customer_price" && w.blocksInvoiceLine));
  });

  it("varnar för gammal lista och prisavvikelse utan att blockera", () => {
    const warns = materialPriceWarnings({
      customerPriceKronor: 120,
      unitCostKronor: 150,
      expectedCostKronor: 100,
      stalePriceList: true,
    });
    assert.ok(warns.some((w) => w.kind === "negative_margin" && !w.blocksInvoiceLine));
    assert.ok(warns.some((w) => w.kind === "stale_price_list" && !w.blocksInvoiceLine));
    assert.ok(warns.some((w) => w.kind === "price_deviation" && !w.blocksInvoiceLine));
  });
});
