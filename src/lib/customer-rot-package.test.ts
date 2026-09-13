process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceDb } from "./store";
import { emptyTestDb, labor, rotReadyCustomer, testCustomer, testWorkLocation } from "./invoices/test-db";
import { createCustomer } from "./services/customers";
import { createInvoice, issueInvoice, updateInvoice } from "./services/invoices";
import { currentVersion, requireCustomer } from "./services/data";
import { createQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { taxReductionExceedsMaxError } from "./tax-reduction-terms";
import { addWorkLocation, removeWorkLocation, workLocationsOf } from "./services/work-locations";
import { CustomerValidationError } from "./customer-validation";
import { WORK_LOCATION_IN_USE_MESSAGE } from "./work-location-label";
import { getInvoiceSendBlockers, InvoiceNotReadyError } from "./invoices/validate";
import { docTotals } from "./calc";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../..");

function source(rel: string): string {
  return readFileSync(join(repoRoot, rel), "utf8");
}

describe("kundkortet: ett ROT/RUT-paket", () => {
  it("identitet och ny kund har varken personnummer eller fastighetsbeteckning", () => {
    for (const rel of [
      "src/components/customer-details-form.tsx",
      "src/components/customer-details-panel.tsx",
      "src/components/new-customer-modal.tsx",
    ]) {
      const src = source(rel);
      assert.doesNotMatch(src, /personnummerInputChange/);
      assert.doesNotMatch(src, /htmlFor="kund-personnummer"/);
      assert.doesNotMatch(src, /htmlFor="ny-kund-personnummer"/);
      assert.doesNotMatch(src, /id="kund-personnummer"/);
      assert.doesNotMatch(src, /id="ny-kund-personnummer"/);
      assert.doesNotMatch(src, /Pers\.nr/);
      assert.doesNotMatch(src, /PropertyDesignationFields/);
      assert.doesNotMatch(src, /Lägg till fastighet/);
      assert.doesNotMatch(src, /id="fastighetsbeteckning"/);
    }
  });

  it("personnummer och beteckning finns en gång, i ROT/RUT", () => {
    const rot = source("src/components/customer-rot-section.tsx");
    assert.equal((rot.match(/function PersonnummerAutosaveField/g) ?? []).length, 1);
    assert.match(rot, /id="kund-personnummer"/);
    assert.match(rot, /Lägg till fastighet/);
    assert.match(rot, /Ta bort/);
    assert.doesNotMatch(rot, /hos andra/);
    assert.doesNotMatch(rot, /kvar att lova/i);
    assert.doesNotMatch(rot, /RotUsedField/);
    assert.doesNotMatch(rot, /Ferva i /);
    assert.doesNotMatch(rot, /inte Skatteverkets saldo/);
    assert.doesNotMatch(rot, /fervaRot/);
    assert.doesNotMatch(rot, /fervaRut/);

    const form = source("src/components/work-location-form.tsx");
    assert.match(form, /Fastighetsbeteckning/);
    assert.doesNotMatch(form, />Namn</);
    assert.doesNotMatch(form, /Personnummer/);

    const page = source("src/app/(app)/kunder/[id]/page.tsx");
    assert.match(page, /<SectionTitle>ROT\/RUT<\/SectionTitle>/);
    assert.match(page, /<CustomerRotSection/);
    assert.doesNotMatch(page, /designations/);
    assert.doesNotMatch(page, /Pers\.nr/);
    assert.doesNotMatch(page, /remainingTaxReduction/);
    assert.doesNotMatch(page, /usedTaxReductionThisYear/);
    assert.doesNotMatch(page, /RotUsedField/);
    assert.doesNotMatch(page, /fervaRot/);
    assert.doesNotMatch(page, /Ferva i /);
    // Årskortet togs bort: kundsidan ska inte visa ROT 0 av 50 000 / RUT 0 av 75 000.
    assert.doesNotMatch(page, /av 50 000/);
    assert.doesNotMatch(page, /av 75 000/);
  });

  it("två fastigheter delar ett personnummer - fältet ligger utanför bostadsformuläret", () => {
    const rot = source("src/components/customer-rot-section.tsx");
    const form = source("src/components/work-location-form.tsx");
    assert.equal(form.includes("Personnummer"), false);
    assert.equal((rot.match(/function PersonnummerAutosaveField/g) ?? []).length, 1);
    assert.match(rot, /Samma nummer för alla fastigheter/);
  });

  it("fastighetsformuläret har inget Namn-fält - etiketten härleds från adress eller beteckning", () => {
    const form = source("src/components/work-location-form.tsx");
    const labels = source("src/lib/work-location-label.ts");
    assert.doesNotMatch(form, />Namn</);
    assert.doesNotMatch(form, /bostad-etikett/);
    assert.doesNotMatch(form, /Hem, Fritidshus/);
    assert.match(form, /derivedPropertyLabel/);
    assert.match(labels, /export function derivedPropertyLabel/);
  });

  it("ny privatkund sparas utan personnummer", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const c = createCustomer({ kind: "privat", name: "Erik" });
    assert.equal(c.personalIdentityNumber, undefined);
    assert.equal(c.workLocations, undefined);
  });

  it("ROT-faktura blockerar utskick utan personnummer och utan bostad", () => {
    replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-erik", name: "Erik" })] }));
    const invoice = createInvoice({
      customerId: "cust-erik",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
    });
    const blockers = getInvoiceSendBlockers(invoice.id);
    assert.ok(blockers.some((b) => b.code === "personnummer"));
    assert.ok(blockers.some((b) => b.code === "property"));
    assert.throws(() => issueInvoice(invoice.id), InvoiceNotReadyError);
  });

  it("vanlig faktura går att utfärda utan personnummer", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-erik", name: "Erik", personalIdentityNumber: undefined })],
      })
    );
    const invoice = createInvoice({
      customerId: "cust-erik",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const issued = issueInvoice(invoice.id);
    assert.equal(issued.status, "skickad");
    assert.equal(getInvoiceSendBlockers(invoice.id).some((b) => b.code === "personnummer"), false);
  });

  it("ROT-faktura med personnummer och bostad är redo", () => {
    const loc = testWorkLocation();
    replaceDb(
      emptyTestDb({
        customers: [
          testCustomer({
            id: "cust-1",
            personalIdentityNumber: "19850515-1234",
            workLocations: [loc],
            defaultWorkLocationId: loc.id,
          }),
        ],
      })
    );
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: loc.id,
    });
    const codes = getInvoiceSendBlockers(invoice.id).map((b) => b.code);
    assert.ok(!codes.includes("personnummer"));
    assert.ok(!codes.includes("property"));
  });

  it("oanvänd fastighet tas bort, använd på faktura blockeras med en mening", () => {
    replaceDb(emptyTestDb({ customers: [rotReadyCustomer()] }));
    const extra = addWorkLocation("cust-1", {
      label: "Vädursvägen",
      address: "Vädursvägen 4",
      city: "Stockholm",
      propertyType: "smahus",
      propertyDesignation: "Aspen 2:14",
    });
    removeWorkLocation("cust-1", extra.id);
    assert.equal(
      workLocationsOf(requireCustomer("cust-1")).some((l) => l.id === extra.id),
      false
    );
    const loc = testWorkLocation();
    replaceDb(
      emptyTestDb({
        customers: [rotReadyCustomer()],
        invoices: [],
      })
    );
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: loc.id,
    });
    assert.equal(invoice.workLocationId, loc.id);
    assert.throws(
      () => removeWorkLocation("cust-1", loc.id),
      (err: unknown) => err instanceof CustomerValidationError && err.message === WORK_LOCATION_IN_USE_MESSAGE
    );
  });

  it("RUT-faktura med personnummer går att utfärda utan vald bostad", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-1", personalIdentityNumber: "19850515-1234" })],
      })
    );
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rut" },
    });
    assert.equal(invoice.workLocationId, undefined);
    assert.equal(getInvoiceSendBlockers(invoice.id).some((b) => b.code === "property"), false);
    const issued = issueInvoice(invoice.id);
    assert.equal(issued.status, "skickad");
  });

  it("RUT-offert med personnummer går att skicka utan vald bostad", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-1", personalIdentityNumber: "19850515-1234" })],
      })
    );
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Städning",
      lines: [labor()],
      rot: { type: "rut" },
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.equal(quote.workLocationId, undefined);
    const sent = sendQuote(quote.id);
    assert.equal(sent.status, "skickad");
  });

  it("sänkt preliminärt avdrag höjer att betala och kan inte överstiga max", () => {
    const loc = testWorkLocation();
    replaceDb(
      emptyTestDb({
        customers: [
          testCustomer({
            id: "cust-1",
            personalIdentityNumber: "19850515-1234",
            workLocations: [loc],
            defaultWorkLocationId: loc.id,
          }),
        ],
      })
    );
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 20_000 })],
      rot: { type: "rot" },
      workLocationId: loc.id,
    });
    const max = docTotals(invoice.lines, { type: "rot" });
    assert.equal(invoice.rot?.appliedTaxReduction, max.calculatedEligibleTaxReduction);
    const lowered = updateInvoice(invoice.id, {
      lines: invoice.lines,
      rot: { type: "rot", appliedTaxReduction: 1_000, taxReductionManuallyAdjusted: true },
    });
    const after = docTotals(lowered.lines, lowered.rot);
    assert.equal(lowered.rot?.appliedTaxReduction, 1_000);
    assert.equal(after.toPay, after.total - 1_000);
    assert.ok(after.toPay > max.toPay);
    assert.throws(
      () =>
        updateInvoice(invoice.id, {
          lines: invoice.lines,
          rot: {
            type: "rot",
            appliedTaxReduction: max.calculatedEligibleTaxReduction + 1,
            taxReductionManuallyAdjusted: true,
          },
        }),
      (err: Error) => err.message === taxReductionExceedsMaxError(max.calculatedEligibleTaxReduction, "faktura")
    );

    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Köksrenovering",
      lines: [labor({ unitPrice: 20_000 })],
      rot: { type: "rot", appliedTaxReduction: 1_000, taxReductionManuallyAdjusted: true },
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    const quoteTotals = docTotals(currentVersion(quote).lines, currentVersion(quote).rot);
    assert.equal(currentVersion(quote).rot?.appliedTaxReduction, 1_000);
    assert.equal(quoteTotals.toPay, quoteTotals.total - 1_000);
    assert.throws(
      () =>
        createQuote({
          customerId: "cust-1",
          title: "För högt avdrag",
          lines: [labor({ unitPrice: 20_000 })],
          rot: {
            type: "rot",
            appliedTaxReduction: max.calculatedEligibleTaxReduction + 1,
            taxReductionManuallyAdjusted: true,
          },
          paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
          paymentTermsDays: defaults.paymentTermsDays,
          validUntil: defaults.validUntil,
          terms: defaults.terms,
        }),
      (err: Error) => err.message === taxReductionExceedsMaxError(max.calculatedEligibleTaxReduction, "offert")
    );
  });

  it("fakturaeditorn: en bostadsväljare, ingen sidotext, beskrivning före ROT", () => {
    const form = source("src/components/doc-form.tsx");
    const lines = form.indexOf("Fakturarader");
    const desc = form.indexOf("<DocDescriptionCard", lines);
    const tax = form.indexOf("Skattereduktion", desc);
    assert.ok(lines > 0 && desc > lines && tax > desc);
    assert.doesNotMatch(form, /Nummer tilldelas när du skickar/);
    assert.doesNotMatch(form, /Koppling till offert är oförändrad/);
    assert.equal((form.match(/<DocDescriptionCard/g) ?? []).length, 2);

    const picker = source("src/components/tax-reduction-document-property.tsx");
    assert.doesNotMatch(picker, /<select/);
    assert.match(picker, /Ny fastighet/);
    assert.doesNotMatch(picker, />Namn</);
    assert.doesNotMatch(picker, /ROT\/RUT kräver att bostaden/);
    assert.match(picker, /ROT kräver att bostaden är vald/);
    assert.match(picker, /type === "rut"/);

    const fields = source("src/components/tax-reduction-fields.tsx");
    assert.doesNotMatch(fields, /Bostadstyp Fastighet/);
    assert.match(fields, /taxReductionDeductionLabel\(type\)\} \{kr\(applied\)\}/);
    assert.match(fields, /onClick=\{startEdit\}/);
    assert.match(fields, /−\{kr\(applied\)\}/);
    assert.match(fields, /onApply\(calculated\)/);
    assert.doesNotMatch(fields, /remainingCap/);
    assert.doesNotMatch(fields, /step=/);
    assert.match(fields, /inputMode="numeric"/);
    assert.match(fields, /\/\^\\d\+\$\//);
  });
});
