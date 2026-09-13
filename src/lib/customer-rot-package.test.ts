process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer, testWorkLocation } from "./invoices/test-db";
import { createCustomer } from "./services/customers";
import { createInvoice, issueInvoice } from "./services/invoices";
import { getInvoiceSendBlockers, InvoiceNotReadyError } from "./invoices/validate";

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
    assert.match(rot, /Fastighetsbeteckning/);
    assert.doesNotMatch(rot, /hos andra/);
    assert.doesNotMatch(rot, /kvar att lova/i);

    const page = source("src/app/(app)/kunder/[id]/page.tsx");
    assert.match(page, /<SectionTitle>ROT\/RUT<\/SectionTitle>/);
    assert.match(page, /<CustomerRotSection/);
    assert.doesNotMatch(page, /designations/);
    assert.doesNotMatch(page, /Pers\.nr/);
    assert.doesNotMatch(page, /remainingTaxReduction/);

    const figures = source("src/components/rot-used-field.tsx");
    assert.match(figures, /Ferva i \{year\}/);
    assert.doesNotMatch(figures, /<input/);
    assert.doesNotMatch(figures, /kvar att lova/i);
    assert.doesNotMatch(figures, /Det kunden redan fått/);
  });

  it("två fastigheter delar ett personnummer - fältet ligger utanför bostadsformuläret", () => {
    const rot = source("src/components/customer-rot-section.tsx");
    const formStart = rot.indexOf("function WorkLocationForm");
    const pnStart = rot.indexOf("function PersonnummerAutosaveField");
    assert.ok(formStart > 0 && pnStart > formStart);
    assert.equal(rot.slice(formStart, pnStart).includes("Personnummer"), false);
    assert.equal((rot.match(/function PersonnummerAutosaveField/g) ?? []).length, 1);
    assert.match(rot, /Samma nummer för alla fastigheter/);
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
});
