process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { createInvoice, issueInvoice } from "../services/invoices";
import { docTotals } from "../calc";
import { hydrateIssuedInvoices } from "./snapshot";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceDocument } from "../../components/invoice-document";
import {
  invoicePaymentRows,
  invoicePaymentTermsLine,
  invoiceQuoteReference,
  invoiceTaxReductionView,
  lineTypeNote,
  sellerIdentityFooter,
} from "./document-view";
import { emptyTestDb, labor, rotReadyCustomer, testCompany, testCustomer, testWorkLocation } from "./test-db";
import { getInvoice } from "../services/data";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

describe("ROT-sektionens databindning", () => {
  it("utkast läser person och fastighet live från fakturans egna uppgifter", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.ok(view);
    assert.equal(view.heading, "ROT-avdrag");
    assert.equal(view.personName, "Anna Andersson");
    assert.equal(view.personalIdentityNumber, "19850515-1234");
    assert.deepEqual(view.propertyRows, [{ label: "Fastighet", value: "Södermalm 1:1" }]);
  });

  it("fastigheten kommer från fakturans valda bostad, inte kundens standard", () => {
    reset({
      customers: [
        rotReadyCustomer({
          workLocations: [
            testWorkLocation(),
            testWorkLocation({ id: "loc-2", label: "Sommarhuset", propertyDesignation: "Skövde Aspen 2:14" }),
          ],
          defaultWorkLocationId: "loc-1",
        }),
      ],
    });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-2",
    });
    // Skrivfixen: lagrade detaljer baseras på fakturans val – inte standardbostaden.
    assert.equal(inv.taxReductionDetails?.housing?.propertyDesignation, "Skövde Aspen 2:14");
    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.deepEqual(view?.propertyRows, [{ label: "Fastighet", value: "Skövde Aspen 2:14" }]);
  });

  it("utfärdad faktura fryser person och fastighet – kundkortet kan ändras fritt", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    issueInvoice(inv.id);
    const customer = db().customers[0];
    customer.name = "Nytt Namn";
    customer.personalIdentityNumber = "20000101-0000";
    customer.workLocations![0].propertyDesignation = "Ny Beteckning 9:9";

    const stored = getInvoice(inv.id)!;
    assert.equal(stored.issuedSnapshot?.buyer.personalIdentityNumber, "19850515-1234");
    const view = invoiceTaxReductionView(stored, { buyer: customer });
    assert.equal(view?.personName, "Anna Andersson");
    assert.equal(view?.personalIdentityNumber, "19850515-1234");
    assert.deepEqual(view?.propertyRows, [{ label: "Fastighet", value: "Södermalm 1:1" }]);
  });

  it("vanlig faktura utan ROT: ingen sektion och inget fryst personnummer", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()], rot: null });
    assert.equal(invoiceTaxReductionView(inv, { buyer: db().customers[0] }), null);
    issueInvoice(inv.id);
    const stored = getInvoice(inv.id)!;
    assert.equal(invoiceTaxReductionView(stored, { buyer: db().customers[0] }), null);
    // Integritet: personnumret lagras inte i snapshoten när dokumentet inte behöver det.
    assert.equal(stored.issuedSnapshot?.buyer.personalIdentityNumber, undefined);
  });

  it("utförandedatum visas som ROT-rad, arbetsperiod som intervall", () => {
    reset({ customers: [rotReadyCustomer()] });
    const single = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      serviceDate: "2026-08-09",
    });
    const singleView = invoiceTaxReductionView(single, { buyer: db().customers[0] });
    assert.deepEqual(singleView?.periodRow, { label: "Utförandedatum", value: "9 augusti 2026" });

    const range = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      taxReductionDetails: { workPeriodStart: "2026-08-12", workPeriodEnd: "2026-08-19" },
    });
    const rangeView = invoiceTaxReductionView(range, { buyer: db().customers[0] });
    assert.deepEqual(rangeView?.periodRow, { label: "Arbetsperiod", value: "12–19 augusti 2026" });
  });

  it("screenshot-caset: Göran Eriksson med 563 kr arbete och 169 kr ROT", () => {
    reset({
      customers: [
        rotReadyCustomer({
          name: "Göran Eriksson",
          personalIdentityNumber: "19800101-1234",
          workLocations: [testWorkLocation({ propertyDesignation: "Skövde Aspen 2:14" })],
        }),
      ],
    });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [
        labor({ description: "Arbete", qty: 1, unit: "tim", unitPrice: 250 }),
        labor({ description: "Rör", qty: 1, unit: "tim", unitPrice: 200 }),
      ],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      serviceDate: "2026-08-09",
    });

    const t = docTotals(inv.lines, inv.rot);
    assert.equal(t.subtotal, 450);
    assert.equal(t.vat, 113);
    assert.equal(t.total, 563);
    assert.equal(t.laborInclVat, 563);
    assert.equal(t.deduction, 169);
    assert.equal(t.toPay, 394);

    const view = invoiceTaxReductionView(inv, { buyer: db().customers[0] });
    assert.ok(view);
    assert.equal(view.personName, "Göran Eriksson");
    assert.equal(view.personalIdentityNumber, "19800101-1234");
    assert.deepEqual(view.propertyRows, [{ label: "Fastighet", value: "Skövde Aspen 2:14" }]);
    assert.deepEqual(view.periodRow, { label: "Utförandedatum", value: "9 augusti 2026" });
    assert.equal(view.laborInclVat, 563);
    assert.equal(view.deduction, 169);
    assert.equal(view.deductionLabel, "Preliminärt ROT-avdrag");
  });
});

describe("Backfill av äldre ROT-snapshots", () => {
  beforeEach(() => reset({ customers: [rotReadyCustomer()] }));

  it("fryser personnumret i befintliga utfärdade ROT-fakturor", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: { type: "rot" },
      workLocationId: "loc-1",
    });
    issueInvoice(inv.id);
    // Simulera en snapshot skapad före fixen (utan personnummer).
    const stored = getInvoice(inv.id)!;
    delete stored.issuedSnapshot!.buyer.personalIdentityNumber;

    assert.equal(hydrateIssuedInvoices(db()), true);
    assert.equal(getInvoice(inv.id)!.issuedSnapshot?.buyer.personalIdentityNumber, "19850515-1234");
    // Idempotent: andra körningen har inget kvar att skriva.
    assert.equal(hydrateIssuedInvoices(db()), false);
  });
});

describe("Betalningsuppgifter som dokumentrader", () => {
  const base = { ocr: "", dueDate: "2026-09-29T10:00:00.000Z", amount: 394 };

  it("visar endast fält med värde – utkast utan OCR får ingen OCR-rad", () => {
    const rows = invoicePaymentRows({
      seller: { bankgiro: "5049-0887", plusgiro: "", bankAccount: "", iban: "", bic: "" },
      ...base,
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ["Bankgiro", "Förfallodatum", "Belopp"]
    );
    assert.equal(rows[0].value, "5049-0887");
    assert.equal(rows[1].value, "29 september 2026");
  });

  it("visar OCR när den finns och döljer bankkonto när IBAN anges", () => {
    const rows = invoicePaymentRows({
      seller: { bankgiro: "", plusgiro: "12 34 56-7", bankAccount: "9999-123456", iban: "SE12 3456", bic: "TESTSESS" },
      ...base,
      ocr: "1048123",
    });
    assert.deepEqual(
      rows.map((r) => r.label),
      ["PlusGiro", "IBAN", "BIC", "OCR", "Förfallodatum", "Belopp"]
    );
  });

  it("betalningsvillkor och dröjsmålsränta blir en kompakt rad", () => {
    assert.equal(
      invoicePaymentTermsLine({ paymentTermsDays: 30, lateInterestRate: 10 }),
      "Betalningsvillkor: 30 dagar · Dröjsmålsränta: 10 % per år"
    );
    assert.equal(invoicePaymentTermsLine({ paymentTermsDays: 20, lateInterestRate: 0 }), "Betalningsvillkor: 20 dagar");
  });
});

describe("Radtyp och referenser på dokumentet", () => {
  it("radtypen visas bara när den tillför något utöver beskrivningen", () => {
    assert.equal(lineTypeNote({ kind: "arbete", description: "Arbete" }), null);
    assert.equal(lineTypeNote({ kind: "arbete", description: "arbete " }), null);
    assert.equal(lineTypeNote({ kind: "arbete", description: "Arbete – montering av kök" }), null);
    assert.equal(lineTypeNote({ kind: "arbete", description: "Rör" }), "Arbete");
    assert.equal(lineTypeNote({ kind: "material", description: "Material" }), null);
    assert.equal(lineTypeNote({ kind: "material", description: "Golvlim" }), "Material");
  });

  it("offertreferensen hämtas ur radernas proveniens", () => {
    assert.equal(invoiceQuoteReference([labor()]), undefined);
    assert.equal(invoiceQuoteReference([labor(), labor({ sourceQuoteNumber: 123 })]), 123);
  });
});

describe("Säljarens sidfot", () => {
  it("bygger 2–3 rader och utelämnar tomma fält", () => {
    const full = sellerIdentityFooter(testCompany());
    assert.deepEqual(
      full.lines.map((line) => line.map((t) => t.text)),
      [
        ["Test Snickeri AB", "Gatan 1", "111 22 Stockholm"],
        ["info@test.se", "08-123 45 67"],
        ["Org.nr 559123-4567", "Momsreg.nr SE559123456701", "Godkänd för F-skatt"],
      ]
    );
    assert.ok(full.lines[2]!.every((t) => t.nowrap));

    const sparse = sellerIdentityFooter({
      name: "Test Snickeri AB",
      address: "",
      postalCode: "",
      city: "",
      email: "info@test.se",
      phone: "",
      orgNumber: "556677-8899",
      vatNumber: "   ",
      approvedForFskatt: false,
    });
    assert.deepEqual(
      sparse.lines.map((line) => line.map((t) => t.text)),
      [["Test Snickeri AB"], ["info@test.se"], ["Org.nr 556677-8899"]]
    );
    assert.equal(
      sparse.lines.flat().some((t) => t.text.startsWith("Momsreg") || t.text.includes("F-skatt")),
      false
    );
  });

  it("renderar kompakt sidfot utan kolumngrid och med nowrap på org/moms/F-skatt", () => {
    reset({ customers: [testCustomer()] });
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor()] });
    const html = renderToStaticMarkup(
      createElement(InvoiceDocument, {
        company: testCompany({ vatNumber: "" }),
        customer: db().customers[0],
        invoice: inv,
      })
    );
    assert.match(html, /data-invoice-seller-footer/);
    assert.doesNotMatch(html, />Adress</);
    assert.doesNotMatch(html, />Kontakt</);
    assert.doesNotMatch(html, />Företag</);
    assert.doesNotMatch(html, /Momsreg\.nr\s*</);
    assert.match(html, /whitespace-nowrap[^>]*>Org\.nr 559123-4567/);
    assert.match(html, /whitespace-nowrap[^>]*>Godkänd för F-skatt/);
    assert.match(html, /Test Snickeri AB/);
    assert.match(html, /Gatan 1/);
  });
});
