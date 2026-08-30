process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import {
  defaultUnitPriceForLineKind,
  parseOptionalHourlyRate,
  settingsFieldErrors,
} from "./settings-validation";
import { getInvoiceDefaults, updateInvoiceDefaults } from "./services/settings";
import { registerJobTime } from "./services/job-work";
import { createJob } from "./services/jobs";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1" })],
    })
  );
}

describe("standard timpris", () => {
  beforeEach(reset);

  it("är inte satt som default", () => {
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
    assert.equal(defaultUnitPriceForLineKind("arbete"), 0);
    assert.equal(defaultUnitPriceForLineKind("arbete", undefined), 0);
  });

  it("tomt fält och 0 räknas som inte satt", () => {
    assert.deepEqual(parseOptionalHourlyRate(""), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate(null), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate(0), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate("  "), { ok: true });
  });

  it("550 kr är giltigt – materialrader påverkas inte", () => {
    assert.deepEqual(parseOptionalHourlyRate(550), { ok: true, value: 550 });
    assert.deepEqual(parseOptionalHourlyRate("550"), { ok: true, value: 550 });
    assert.equal(defaultUnitPriceForLineKind("arbete", 550), 550);
    assert.equal(defaultUnitPriceForLineKind("material", 550), 0);
    assert.equal(defaultUnitPriceForLineKind("resor", 550), 0);
  });

  it("negativt eller orimligt värde avvisas", () => {
    assert.equal(parseOptionalHourlyRate(-1).ok, false);
    assert.equal(parseOptionalHourlyRate("abc").ok, false);
    assert.equal(parseOptionalHourlyRate(2_000_000).ok, false);
    const errors = settingsFieldErrors({
      name: "Test",
      orgNumber: "",
      vatNumber: "",
      bankgiro: "",
      paymentTermsDays: 30,
      lateInterestRate: 10,
      quoteValidityDays: 30,
      defaultVatRate: 25,
      defaultHourlyRate: "nej",
    });
    assert.equal(errors[0]?.field, "defaultHourlyRate");
    assert.equal(errors[0]?.tab, "standardval");
  });

  it("sparas och kan rensas under Standardval", () => {
    const defaults = getInvoiceDefaults();
    updateInvoiceDefaults({ ...defaults, defaultHourlyRate: 550 });
    assert.equal(db().settings.defaultHourlyRate, 550);
    assert.equal(getInvoiceDefaults().defaultHourlyRate, 550);

    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: undefined });
    assert.equal(db().settings.defaultHourlyRate, undefined);
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
  });

  it("förifylls på tidregistrering när offerten inte har ett pris", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 550 });
    const job = createJob({ customerId: "cust-1", title: "Hylla", description: "Bygga hylla" });
    const entry = registerJobTime(job.id, { hours: 2, description: "Montering" });
    assert.equal(entry.unitPrice, 550);
    assert.equal(entry.qty, 2);
  });
});
