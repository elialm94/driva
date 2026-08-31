process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  applyArbeteLineDefaults,
  createDocLine,
  isEmptyUnitPrice,
  resolvedHourlyRate,
} from "./line-defaults";
import { parseOptionalHourlyRate, settingsFieldErrors } from "./settings-validation";
import { parseSettingsFlik, SETTINGS_TABS } from "./settings-routes";
import { getInvoiceDefaults, updateInvoiceDefaults } from "./services/settings";
import { createQuote, quoteDefaults } from "./services/quotes";
import { isoDaysFromNow } from "./format";
import { createInvoice } from "./services/invoices";
import { currentVersion } from "./services/data";
import { createJob } from "./services/jobs";
import { registerJobTime } from "./services/job-work";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1" })],
    })
  );
}

describe("inställningsflikar", () => {
  it("har inte Standardval – Fakturering samlar dokumentdefault", () => {
    assert.deepEqual(
      SETTINGS_TABS.map((t) => t.key),
      ["foretag", "fakturering", "funktioner", "konto"]
    );
    assert.ok(!SETTINGS_TABS.some((t) => t.label === "Standardval"));
    assert.equal(parseSettingsFlik("standardval"), "fakturering");
    assert.equal(parseSettingsFlik("fakturering"), "fakturering");
    assert.equal(parseSettingsFlik("konto"), "konto");
  });

  it("betalningsvillkor och dröjsmålsränta valideras en gång under Fakturering", () => {
    const errors = settingsFieldErrors({
      name: "Test",
      orgNumber: "",
      vatNumber: "",
      bankgiro: "",
      paymentTermsDays: 0,
      lateInterestRate: -1,
      quoteValidityDays: 30,
      defaultVatRate: 25,
    });
    assert.deepEqual(
      errors.map((e) => e.field),
      ["paymentTermsDays", "lateInterestRate"]
    );
    assert.ok(errors.every((e) => e.tab === "fakturering"));
    assert.equal(errors.filter((e) => e.field === "paymentTermsDays").length, 1);
    assert.equal(errors.filter((e) => e.field === "lateInterestRate").length, 1);
  });
});

describe("standard timpris", () => {
  beforeEach(reset);

  it("är inte satt som default", () => {
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
    assert.equal(db().settings.defaultHourlyRate, undefined);
    assert.equal(resolvedHourlyRate(undefined), undefined);
    assert.equal(isEmptyUnitPrice(0), true);
  });

  it("tomt fält och 0 räknas som inte satt", () => {
    assert.deepEqual(parseOptionalHourlyRate(""), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate(null), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate(0), { ok: true });
    assert.deepEqual(parseOptionalHourlyRate("  "), { ok: true });
  });

  it("CASE A: tomt timpris → + Arbete ger ingen extra prisdefault", () => {
    const line = createDocLine("arbete", { defaultVatRate: 25 });
    assert.equal(line.kind, "arbete");
    assert.equal(line.qty, 1);
    assert.equal(line.unit, "tim");
    assert.equal(line.unitPrice, 0);
    assert.equal(line.vatRate, 25);
    assert.equal(line.description, "");
  });

  it("CASE B: 650 kr och 25 % moms → + Arbete förifyller antal, enhet, pris och moms", () => {
    const line = createDocLine("arbete", { defaultHourlyRate: 650, defaultVatRate: 25 });
    assert.equal(line.kind, "arbete");
    assert.equal(line.qty, 1);
    assert.equal(line.unit, "tim");
    assert.equal(line.unitPrice, 650);
    assert.equal(line.vatRate, 25);
    assert.equal(line.description, "");
  });

  it("CASE C: samma default används för ny fakturarad", () => {
    const quoteLine = createDocLine("arbete", { defaultHourlyRate: 650, defaultVatRate: 25 });
    const invoiceLine = createDocLine("arbete", { defaultHourlyRate: 650, defaultVatRate: 25 });
    assert.equal(quoteLine.unitPrice, invoiceLine.unitPrice);
    assert.equal(invoiceLine.unit, "tim");
    assert.equal(invoiceLine.vatRate, 25);
  });

  it("CASE D: ändrat à-pris på raden behålls – inställningen rörs inte", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const line = createDocLine("arbete", getInvoiceDefaults());
    assert.equal(line.unitPrice, 650);
    line.unitPrice = 725;
    assert.equal(line.unitPrice, 725);
    assert.equal(getInvoiceDefaults().defaultHourlyRate, 650);
  });

  it("CASE E: befintlig offert behåller 650 när inställningen blir 700", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const quote = createQuote({
      customerId: "cust-1",
      title: "Köksrenovering",
      intro: "",
      lines: [labor({ description: "Snickeri", qty: 1, unit: "tim", unitPrice: 650, vatRate: 25 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 700 });
    assert.equal(currentVersion(quote).lines[0].unitPrice, 650);
    const next = createDocLine("arbete", getInvoiceDefaults());
    assert.equal(next.unitPrice, 700);
  });

  it("ny faktura kopierar betalningsvillkor vid skapande – inte live", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), paymentTermsDays: 14, lateInterestRate: 8 });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [],
      rot: null,
    });
    updateInvoiceDefaults({ ...getInvoiceDefaults(), paymentTermsDays: 45, lateInterestRate: 12 });
    assert.equal(invoice.paymentTermsDays, 14);
    assert.equal(invoice.lateInterestRate, 8);
  });

  it("offertens giltighetstid sätts vid skapande från quoteValidityDays", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), quoteValidityDays: 30 });
    const defaults = quoteDefaults();
    assert.equal(defaults.validUntil, isoDaysFromNow(30));
  });

  it("Material → Arbete behåller ett ifyllt à-pris", () => {
    const changed = applyArbeteLineDefaults(
      { kind: "arbete", type: "LABOR" as const, unit: "st", unitPrice: 900, vatRate: 25 as const },
      { defaultHourlyRate: 650, defaultVatRate: 25 }
    );
    assert.equal(changed.unitPrice, 900);
    assert.equal(changed.unit, "tim");
  });

  it("tom Material-rad som byts till Arbete får standardtimpris", () => {
    const changed = applyArbeteLineDefaults(
      { kind: "arbete", type: "LABOR" as const, unit: "st", unitPrice: 0, vatRate: 25 as const },
      { defaultHourlyRate: 650, defaultVatRate: 25 }
    );
    assert.equal(changed.unitPrice, 650);
    assert.equal(changed.unit, "tim");
  });

  it("Material / Restid / Övrigt påverkas inte av standardtimpris", () => {
    for (const kind of ["material", "resor", "ovrigt"] as const) {
      const line = createDocLine(kind, { defaultHourlyRate: 650, defaultVatRate: 25 });
      assert.equal(line.unitPrice, 0);
      assert.notEqual(line.kind, "arbete");
    }
  });

  it("startar inte en dokumentrad automatiskt – applyHourlyRate: false lämnar 0", () => {
    const starter = createDocLine("arbete", { defaultHourlyRate: 650, defaultVatRate: 25 }, { applyHourlyRate: false });
    assert.equal(starter.unitPrice, 0);
    assert.equal(starter.unit, "tim");
  });

  it("sparas och kan rensas under Fakturering", () => {
    const defaults = getInvoiceDefaults();
    updateInvoiceDefaults({ ...defaults, defaultHourlyRate: 650 });
    assert.equal(db().settings.defaultHourlyRate, 650);
    assert.equal(getInvoiceDefaults().defaultHourlyRate, 650);

    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: undefined });
    assert.equal(db().settings.defaultHourlyRate, undefined);
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
  });

  it("förifylls på tidregistrering när offerten inte har ett pris", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const job = createJob({ customerId: "cust-1", title: "Hylla", description: "Bygga hylla" });
    const entry = registerJobTime(job.id, { hours: 2, description: "Montering" });
    assert.equal(entry.unitPrice, 650);
    assert.equal(entry.qty, 2);
    assert.equal(entry.unit, "tim");
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
    assert.equal(errors[0]?.tab, "fakturering");
  });
});
