process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db, replaceDb } from "../store";
import { createInvoice, issueInvoice, markInvoicePaid } from "../services/invoices";
import { createTaxReductionUnderlag } from "../services/tax-reduction";
import { buildHusExportFile } from "../services/hus-export";
import { setJobStatus } from "../services/jobs";
import { getInvoice, getJob } from "../services/data";
import { buildSeed } from "../seed";
import { docTotals } from "../calc";
import { InvoiceDocument } from "../../components/invoice-document";
import { invoiceTaxReductionView } from "./document-view";
import { emptyTestDb, labor, rotReadyCustomer, testCompany, testWorkLocation } from "./test-db";

/**
 * Vad fakturadokumentet visar – skärm, kundvy och PDF renderar samma
 * InvoiceDocument, så ett rendertest räcker för alla tre.
 *
 * Personnumret i fixturerna är påhittat (1985-05-15 finns som seedvärde och
 * är inte någons riktiga nummer). Hela numret får aldrig stå på dokumentet.
 */

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function renderDocument(invoiceId: string): string {
  const data = db();
  const invoice = getInvoice(invoiceId)!;
  const customer = data.customers.find((c) => c.id === invoice.customerId)!;
  return renderToStaticMarkup(
    createElement(InvoiceDocument, { company: testCompany(), customer, invoice })
  );
}

function rotInvoice() {
  return createInvoice({
    customerId: "cust-1",
    type: "faktura",
    lines: [labor()],
    rot: { type: "rot" },
    workLocationId: "loc-1",
  });
}

describe("Fakturadokumentet: personnumret maskeras", () => {
  it("ROT-utkast visar maskerat personnummer på dokumentet, aldrig hela", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = rotInvoice();

    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.equal(view?.personalIdentityNumberMasked, "1985••••-1234");

    const html = renderDocument(inv.id);
    assert.match(html, /1985••••-1234/);
    assert.doesNotMatch(html, /19850515-1234/);
    // Födelsedag och månad är det som maskeringen ska dölja.
    assert.doesNotMatch(html, /0515/);
  });

  it("utfärdad ROT-faktura maskerar det frusna numret – snapshoten behåller hela", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = rotInvoice();
    issueInvoice(inv.id);

    const stored = getInvoice(inv.id)!;
    assert.equal(stored.issuedSnapshot?.buyer.personalIdentityNumber, "19850515-1234");

    const view = invoiceTaxReductionView(stored, { buyer: db().customers[0] });
    assert.equal(view?.personalIdentityNumberMasked, "1985••••-1234");

    const html = renderDocument(inv.id);
    assert.match(html, /1985••••-1234/);
    assert.doesNotMatch(html, /19850515-1234/);
  });

  it("begäran till Skatteverket har hela numret medan dokumentet har det maskerade", () => {
    replaceDb(buildSeed());
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ qty: 40, unit: "tim", unitPrice: 1_000 })],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    createTaxReductionUnderlag({ jobId: "job-kok", invoiceId: inv.id });

    const file = buildHusExportFile({ jobId: "job-kok" });
    assert.match(file.xml, /198505151234/, "Skatteverket ska få hela personnumret oförändrat");

    const html = renderDocument(inv.id);
    assert.match(html, /1985••••-1234/);
    assert.doesNotMatch(html, /19850515-1234/);
  });
});

describe("Fakturadokumentet: nollrader", () => {
  it("rad med 0 kr renderas inte, men ligger kvar på fakturan", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ description: "Snickeriarbete", unitPrice: 1_000 }),
        labor({ kind: "material", description: "Skruv", qty: 1, unit: "st", unitPrice: 0 }),
      ],
      rot: null,
    });

    const html = renderDocument(inv.id);
    assert.match(html, /Snickeriarbete/);
    assert.doesNotMatch(html, /Skruv/);
    // Raden är kvar i datan: bokföring, snapshot och HUS-underlag läser lines.
    assert.equal(getInvoice(inv.id)!.lines.length, 2);
    assert.equal(docTotals(inv.lines, null).total, 1_250);
  });

  it("rubrikrad renderas trots att den alltid summerar till 0", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ description: "Kök", isHeading: true, unitPrice: 0 }),
        labor({ description: "Snickeriarbete", unitPrice: 1_000 }),
      ],
      rot: null,
    });

    const html = renderDocument(inv.id);
    assert.match(html, />Kök</);
  });

  it("momssats som bara nollraden bar listas inte i summeringen", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ description: "Snickeriarbete", unitPrice: 1_000, vatRate: 25 }),
        labor({ kind: "material", description: "Trycksak", unitPrice: 0, vatRate: 6 }),
      ],
      rot: null,
    });

    const html = renderDocument(inv.id);
    assert.match(html, /Moms 25 %/);
    assert.doesNotMatch(html, /Moms 6 %/);
  });
});

describe("Fakturadokumentet: fastighetsbeteckning", () => {
  it("ROT visar fastighetsbeteckningen i avdragsblocket", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = rotInvoice();

    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.deepEqual(view?.propertyRows, [{ label: "Fastighetsbeteckning", value: "Södermalm 1:1" }]);

    const html = renderDocument(inv.id);
    assert.match(html, /Fastighetsbeteckning/);
    assert.match(html, /Södermalm 1:1/);
  });

  it("RUT visar ingen beteckning ens när kunden har en registrerad småhusbostad", () => {
    reset({ customers: [rotReadyCustomer({ workLocations: [testWorkLocation()] })] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rut" },
      workLocationId: "loc-1",
    });

    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.equal(view?.heading, "RUT-avdrag");
    assert.deepEqual(view?.propertyRows, []);

    const html = renderDocument(inv.id);
    assert.doesNotMatch(html, /Fastighetsbeteckning/);
    assert.doesNotMatch(html, /Södermalm 1:1/);
  });

  it("beteckningen följer med till den utfärdade fakturans dokument", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = rotInvoice();
    issueInvoice(inv.id);

    const html = renderDocument(inv.id);
    assert.match(html, /Fastighetsbeteckning/);
    assert.match(html, /Södermalm 1:1/);
  });
});
