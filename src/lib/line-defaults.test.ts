process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  applyArbeteLineDefaults,
  canonicalizeUnitPrice,
  createDocLine,
  isEmptyUnitPrice,
  isUnsetUnitPrice,
  pickUnitPrice,
  resolvedHourlyRate,
} from "./line-defaults";
import { parseOptionalHourlyRate, settingsFieldErrors } from "./settings-validation";
import { parseSettingsFlik, SETTINGS_TABS } from "./settings-routes";
import { getInvoiceDefaults, updateInvoiceDefaults } from "./services/settings";
import { createQuote, quoteDefaults } from "./services/quotes";
import { isoDaysFromNow, kr } from "./format";
import { createInvoice } from "./services/invoices";
import { currentVersion } from "./services/data";
import { createJob } from "./services/jobs";
import { registerJobTime } from "./services/job-work";
import { collectLineBlockers } from "./invoices/validate";
import { docTotals } from "./calc";
import { validatePriceLine } from "./form-requirements";

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

describe("0 vs tomt à-pris (nullish)", () => {
  it("0 ?? default behåller 0; 0 || default återställer felaktigt", () => {
    const defaultPrice = 650;
    assert.equal(0 ?? defaultPrice, 0);
    assert.equal(0 || defaultPrice, 650);
    assert.equal(undefined ?? defaultPrice, 650);
    assert.equal(null ?? defaultPrice, 650);
    assert.equal(pickUnitPrice(0, defaultPrice), 0);
    assert.equal(pickUnitPrice(undefined, defaultPrice), 650);
    assert.equal(pickUnitPrice(null, defaultPrice), 650);
  });

  it("0 är satt på raden; null/undefined/\"\" är osatt", () => {
    assert.equal(isUnsetUnitPrice(0), false);
    assert.equal(isEmptyUnitPrice(0), false);
    assert.equal(isUnsetUnitPrice(null), true);
    assert.equal(isUnsetUnitPrice(undefined), true);
    assert.equal(isUnsetUnitPrice(""), true);
    assert.equal(canonicalizeUnitPrice(""), 0);
    assert.equal(canonicalizeUnitPrice(undefined), 0);
    assert.equal(canonicalizeUnitPrice(0), 0);
    assert.equal(canonicalizeUnitPrice(-200), -200);
  });

  it("standardtimpris 0 i inställningen räknas som inte satt", () => {
    assert.equal(resolvedHourlyRate(undefined), undefined);
    assert.equal(resolvedHourlyRate(null), undefined);
    assert.equal(resolvedHourlyRate(""), undefined);
    assert.equal(resolvedHourlyRate(0), undefined);
    assert.equal(resolvedHourlyRate(650), 650);
  });
});

describe("standard timpris", () => {
  beforeEach(reset);

  it("är inte satt som default", () => {
    assert.equal(getInvoiceDefaults().defaultHourlyRate, undefined);
    assert.equal(db().settings.defaultHourlyRate, undefined);
    assert.equal(resolvedHourlyRate(undefined), undefined);
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

  it("TEST B: användaren sätter 0 och 650 kommer inte tillbaka", () => {
    const line = createDocLine("arbete", { defaultHourlyRate: 650, defaultVatRate: 25 });
    line.unitPrice = 0;
    const again = applyArbeteLineDefaults(line, { defaultHourlyRate: 650, defaultVatRate: 25 });
    assert.equal(again.unitPrice, 0);
    assert.equal(pickUnitPrice(0, 650), 0);
  });

  it("CASE E: befintlig offert behåller 650 när inställningen blir 700", () => {
    updateInvoiceDefaults({ ...getInvoiceDefaults(), defaultHourlyRate: 650 });
    const quote = createQuote({
      customerId: "cust-1",
      title: "Köksrenovering",
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

  it("byte till Arbete skriver inte över explicit 0", () => {
    const changed = applyArbeteLineDefaults(
      { kind: "arbete", type: "LABOR" as const, unit: "st", unitPrice: 0, vatRate: 25 as const },
      { defaultHourlyRate: 650, defaultVatRate: 25 }
    );
    assert.equal(changed.unitPrice, 0);
    assert.equal(changed.unit, "tim");
  });

  it("osatt à-pris på ny Arbete-rad får 650", () => {
    const changed = applyArbeteLineDefaults(
      { kind: "arbete", type: "LABOR" as const, unit: "st", vatRate: 25 as const },
      { defaultHourlyRate: 650, defaultVatRate: 25 }
    );
    assert.equal(changed.unitPrice, 650);
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

describe("0-kr rader: totaler, visning, persistens", () => {
  beforeEach(reset);

  it("TEST A: Städning 1 st 0 kr 25 % → giltig, summa 0, visas som 0 kr", () => {
    const lines = [labor({ description: "Städning", qty: 1, unit: "st", unitPrice: 0, vatRate: 25 })];
    const t = docTotals(lines, null);
    assert.equal(t.subtotal, 0);
    assert.equal(t.vat, 0);
    assert.equal(t.total, 0);
    assert.equal(t.toPay, 0);
    assert.equal(t.laborInclVat, 0);
    assert.match(kr(0), /0\s*kr/);
    assert.deepEqual(validatePriceLine(lines[0]!), []);
  });

  it("0-kr-rad ändrar inte summan av betalda rader och ger inte NaN", () => {
    const paid = labor({ description: "Snickeri", qty: 2, unitPrice: 500, vatRate: 25 });
    const free = labor({ id: "free", description: "Montering", qty: 1, unit: "tim", unitPrice: 0, vatRate: 25 });
    const without = docTotals([paid], null);
    const withFree = docTotals([paid, free], null);
    assert.equal(withFree.subtotal, without.subtotal);
    assert.equal(withFree.vat, without.vat);
    assert.equal(withFree.total, without.total);
    assert.ok([withFree.subtotal, withFree.vat, withFree.total, withFree.toPay].every(Number.isFinite));
  });

  it("Arbete på 0 ger ROT-underlag 0", () => {
    const t = docTotals([labor({ description: "Arbete", kind: "arbete", unitPrice: 0, vatRate: 25 })], { type: "rot" });
    assert.equal(t.laborInclVat, 0);
    assert.equal(t.calculatedEligibleTaxReduction, 0);
    assert.equal(t.deduction, 0);
  });

  it("TEST E: spara + läs tillbaka behåller 0, inte null eller 650", () => {
    db().settings.defaultHourlyRate = 650;
    const quote = createQuote({
      customerId: "cust-1",
      title: "Ingår",
      lines: [labor({ description: "Städning", qty: 1, unit: "st", unitPrice: 0, vatRate: 25 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    const reloaded = currentVersion(quote).lines[0];
    assert.equal(reloaded?.unitPrice, 0);
    assert.notEqual(reloaded?.unitPrice, null);
    assert.notEqual(reloaded?.unitPrice, 650);
    assert.equal(reloaded?.description, "Städning");

    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ description: "Bortforsling", qty: 1, unit: "st", unitPrice: 0, vatRate: 25 })],
      rot: null,
    });
    assert.equal(invoice.lines[0]?.unitPrice, 0);
    assert.deepEqual(collectLineBlockers(invoice), []);
  });

  it("TEST B + E: tidregistrering 0 stannar på 0 trots standardtimpris 650", () => {
    db().settings.defaultHourlyRate = 650;
    assert.equal(quoteDefaults().defaultHourlyRate, 650);
    const job = createJob({ customerId: "cust-1", title: "Hylla", description: "Bygga hylla" });
    const prefilled = registerJobTime(job.id, { hours: 1, description: "Arbete" });
    assert.equal(prefilled.unitPrice, 650);
    const free = registerJobTime(job.id, { hours: 1, description: "Montering", unitPrice: 0 });
    assert.equal(free.unitPrice, 0);
  });
});
