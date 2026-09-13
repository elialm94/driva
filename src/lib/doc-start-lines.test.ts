process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { getInvoiceDefaults, updateInvoiceDefaults } from "./services/settings";
import { quoteDefaults } from "./services/quotes";
import { newLine, startLines } from "../components/lines-editor";

/**
 * Startraden i en ny offert/faktura är samma rad som + Arbete lägger till.
 * Buggen: startraden byggdes utan standardtimpriset, så Arbete-raden låg på
 * 0 kr medan en tillagd rad fick 650 kr ur samma inställning.
 */
describe("startrader i ny offert och ny faktura", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1" })] }));
  });

  it("Arbete-startraden får standardtimpriset ur inställningarna", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const [arbete] = startLines(["arbete"], getInvoiceDefaults());
    assert.equal(arbete?.unitPrice, 650);
    assert.equal(arbete?.unit, "tim");
    assert.equal(arbete?.qty, 1);
  });

  it("startraden och + Arbete ger samma pris, enhet och moms", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 725, defaultVatRate: 12 });
    const defaults = getInvoiceDefaults();
    const [start] = startLines(["arbete"], defaults);
    const added = newLine("arbete", defaults.defaultVatRate ?? 25, undefined, defaults.defaultHourlyRate);
    assert.equal(start?.unitPrice, added.unitPrice);
    assert.equal(start?.unit, added.unit);
    assert.equal(start?.vatRate, added.vatRate);
  });

  it("offertens startrader: Arbete får timpriset, Material lämnas på 0", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const [arbete, material] = startLines(["arbete", "material"], quoteDefaults());
    assert.equal(arbete?.unitPrice, 650);
    assert.equal(material?.unitPrice, 0);
    assert.equal(material?.unit, "st");
  });

  it("osatt timpris ger 0 på startraden, precis som på + Arbete", () => {
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
    const [start] = startLines(["arbete"], getInvoiceDefaults());
    assert.equal(start?.unitPrice, 0);
    assert.equal(start?.unitPrice, newLine("arbete", 25, undefined, undefined).unitPrice);
  });

  it("timpris 0 i inställningen räknas som osatt och ger 0", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 0 });
    const [start] = startLines(["arbete"], getInvoiceDefaults());
    assert.equal(start?.unitPrice, 0);
  });

  it("startradernas id:n är stabila – annars spricker hydreringen", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const first = startLines(["arbete", "material"], getInvoiceDefaults());
    const second = startLines(["arbete", "material"], getInvoiceDefaults());
    assert.deepEqual(
      first.map((l) => l.id),
      ["start-arbete", "start-material"]
    );
    assert.deepEqual(
      first.map((l) => l.id),
      second.map((l) => l.id)
    );
  });
});
