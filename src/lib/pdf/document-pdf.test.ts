process.env.DRIVA_TEST = "1";

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "../store";
import { emptyTestDb, labor, rotReadyCustomer, testCompany, testCustomer, testWorkLocation } from "../invoices/test-db";
import { createQuote, quoteDefaults, sendQuote } from "../services/quotes";
import { createInvoice, issueInvoice } from "../services/invoices";
import { currentVersion, getInvoice } from "../services/data";
import { updateCustomer } from "../services/customers";
import { docTotals } from "../calc";
import { kr } from "../format";
import { quoteVersionHash } from "../hash";
import { documentPdfFilename, slugName } from "./filename";
import { quotePdfModel, invoicePdfModel } from "./document-model";
import { renderQuotePdf, renderInvoicePdf } from "./business-document";
import { db } from "../store";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function quoteInput(over: Partial<Parameters<typeof createQuote>[0]> = {}) {
  const defaults = quoteDefaults();
  return {
    customerId: over.customerId ?? "cust-1",
    title: over.title ?? "Köksrenovering",
    intro: over.intro ?? "Vi renoverar köket enligt underlaget.",
    lines: over.lines ?? [labor({ unitPrice: 8_000 })],
    rot: over.rot === undefined ? null : over.rot,
    workLocationId: over.workLocationId,
    paymentPlan: over.paymentPlan ?? [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: over.paymentTermsDays ?? defaults.paymentTermsDays,
    validUntil: over.validUntil ?? defaults.validUntil,
    terms: over.terms ?? defaults.terms,
  };
}

function pdfText(bytes: Buffer): string {
  return bytes.toString("latin1");
}

function assertPdf(bytes: Buffer) {
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  assert.match(bytes.toString("latin1"), /%%EOF/);
}

describe("PDF-filnamn", () => {
  it("normaliserar svenska namn säkert", () => {
    assert.equal(documentPdfFilename("offert", 116, "Sara Nilsson"), "Offert-116-Sara-Nilsson.pdf");
    assert.equal(documentPdfFilename("faktura", 1042, "Brf Eken"), "Faktura-1042-Brf-Eken.pdf");
    assert.equal(documentPdfFilename("faktura", null, "Åke Öberg"), "Faktura-utkast-Ake-Oberg.pdf");
    assert.equal(slugName("Sara / Nilsson?"), "Sara-Nilsson");
  });
});

describe("Offert-PDF", () => {
  beforeEach(() => reset());

  it("A: normal offert – totals och villkor matchar motorn", () => {
    const quote = createQuote(quoteInput({ title: "Bokhylla ÅÄÖ" }));
    const version = currentVersion(quote);
    const t = docTotals(version.lines, version.rot);
    const model = quotePdfModel(quote, { seller: db().settings, buyer: db().customers[0] }, version);
    assert.equal(model.toPay, kr(t.toPay));
    assert.ok(model.terms?.includes("F-skattsedel"));
    const pdf = renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] }, version);
    assertPdf(pdf.bytes);
    assert.equal(pdf.filename, "Offert-1-Anna-Andersson.pdf");
    const text = pdfText(pdf.bytes);
    assert.match(text, /Bokhylla/);
    assert.match(text, /Offert/);
    assert.match(text, /Test Snickeri/);
    assert.match(text, /559123-4567/);
    assert.match(text, /SE559123456701/);
    assert.match(text, /Anna Andersson/);
    assert.match(text, /Folkungagatan/);
    assert.match(text, /F-skattsedel|fullst|Villkor/i);
    assert.ok(text.includes("UTKAST"));
  });

  it("H: svenska tecken ÅÄÖ kodas i WinAnsi", () => {
    const quote = createQuote(quoteInput({ title: "ÅÄÖ-renovering", intro: "Göran på Södermalm." }));
    const pdf = renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] });
    const text = pdfText(pdf.bytes);
    assert.match(text, /\\305\\304\\326-renovering|ÅÄÖ-renovering/);
    assert.match(text, /G\\366ran|Göran/);
  });

  it("B: ROT-offert visar avdrag, disclaimer och fastighet", () => {
    reset({ customers: [rotReadyCustomer()] });
    const quote = createQuote(
      quoteInput({
        rot: { type: "rot" },
        workLocationId: "loc-1",
        lines: [labor({ unitPrice: 20_000 })],
      })
    );
    const version = currentVersion(quote);
    const t = docTotals(version.lines, version.rot);
    const model = quotePdfModel(quote, { seller: db().settings, buyer: db().customers[0] }, version);
    assert.equal(model.toPay, kr(t.toPay));
    assert.ok(model.housing?.some((h) => h.includes("Södermalm 1:1")));
    assert.ok(model.rotBody?.includes("preliminärt"));
    const pdf = renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] }, version);
    const text = pdfText(pdf.bytes);
    assert.match(text, /S.dermalm 1:1|Södermalm 1:1|S\\366dermalm/);
    assert.match(text, /ROT|prelimin/);
    assert.match(text, /Bostad|Fastighet/);
  });

  it("C: betalningsplan syns med alla steg", () => {
    const quote = createQuote(
      quoteInput({
        paymentPlan: [
          { label: "Start", percent: 40 },
          { label: "Slut", percent: 60 },
        ],
      })
    );
    const model = quotePdfModel(quote, { seller: db().settings, buyer: db().customers[0] });
    assert.equal(model.paymentPlan?.length, 2);
    assert.ok(model.paymentPlan?.some((p) => p.label.includes("Start")));
    assert.ok(model.paymentPlan?.some((p) => p.label.includes("Slut")));
    const text = pdfText(renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] }).bytes);
    assert.match(text, /Start/);
    assert.match(text, /Slut/);
    assert.match(text, /BETALNINGSPLAN/);
  });

  it("D: signerad/skickad offert behåller kundadress efter kundkortsändring", () => {
    const quote = createQuote(quoteInput());
    sendQuote(quote.id);
    const version = currentVersion(quote);
    assert.ok(version.buyerSnapshot);
    assert.equal(version.buyerSnapshot?.address, "Folkungagatan 1");
    const hashBefore = quoteVersionHash(version);
    updateCustomer("cust-1", { address: "Ny gata 99", city: "Göteborg", postalCode: "411 01", name: "Anna Andersson" });
    assert.equal(quoteVersionHash(currentVersion(quote)), hashBefore);
    const model = quotePdfModel(quote, { seller: db().settings, buyer: db().customers[0] }, currentVersion(quote));
    assert.equal(model.buyerAddress.some((l) => l.includes("Folkungagatan 1")), true);
    assert.equal(model.buyerAddress.some((l) => l.includes("Ny gata")), false);
    const text = pdfText(renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] }).bytes);
    assert.match(text, /Folkungagatan/);
    assert.equal(text.includes("Ny gata"), false);
    assert.equal(text.includes("UTKAST"), false);
  });

  it("G: många rader ger flersidig PDF utan att rader försvinner", () => {
    const lines = Array.from({ length: 40 }, (_, i) =>
      labor({ id: `line-${i}`, description: `Rad ${i + 1} ÅÄÖ-arbete`, unitPrice: 500 + i })
    );
    const quote = createQuote(quoteInput({ lines, title: "Stor offert" }));
    const pdf = renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] });
    assertPdf(pdf.bytes);
    const text = pdfText(pdf.bytes);
    assert.match(text, /Sida 1 av /);
    assert.match(text, /Rad 1 /);
    assert.match(text, /Rad 40 /);
    const t = docTotals(currentVersion(quote).lines, null);
    const model = quotePdfModel(quote, { seller: db().settings, buyer: db().customers[0] });
    assert.equal(model.toPay, kr(t.toPay));
    assert.match(text, /Att betala/);
    assert.ok(pdf.bytes.includes(Buffer.from("%%EOF")));
  });
});

describe("Faktura-PDF", () => {
  beforeEach(() => reset());

  it("E: normal faktura – totals, OCR och betalning", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 4_000 })],
      rot: null,
    });
    const issued = issueInvoice(inv.id);
    const stored = getInvoice(issued.id)!;
    const t = docTotals(stored.issuedSnapshot!.lines, stored.issuedSnapshot!.rot);
    const model = invoicePdfModel(stored, { seller: db().settings, buyer: db().customers[0] });
    assert.equal(model.toPay, kr(t.toPay));
    assert.equal(model.draft, false);
    assert.ok(model.paymentBox?.some((r) => r.label === "OCR"));
    const pdf = renderInvoicePdf(stored, { seller: db().settings, buyer: db().customers[0] });
    assertPdf(pdf.bytes);
    assert.equal(pdf.filename, `Faktura-${stored.number}-Anna-Andersson.pdf`);
    const text = pdfText(pdf.bytes);
    assert.match(text, /Faktura/);
    assert.match(text, /5678-1234/);
    assert.match(text, /OCR/);
    assert.equal(text.includes("UTKAST"), false);
  });

  it("F: ROT-faktura visar avdrag och fastighet", () => {
    reset({ customers: [rotReadyCustomer()] });
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 20_000 })],
      rot: { type: "rot" },
      workLocationId: "loc-1",
      taxReductionDetails: {
        workAddress: "Folkungagatan 1, 116 30 Stockholm",
        housing: { dwellingType: "smahus", propertyDesignation: "Södermalm 1:1" },
      },
    });
    const issued = issueInvoice(inv.id);
    const stored = getInvoice(issued.id)!;
    const t = docTotals(stored.issuedSnapshot!.lines, stored.issuedSnapshot!.rot);
    const model = invoicePdfModel(stored, { seller: db().settings, buyer: db().customers[0] });
    assert.equal(model.toPay, kr(t.toPay));
    assert.ok(model.housing?.some((h) => h.includes("Södermalm 1:1")));
    const text = pdfText(renderInvoicePdf(stored, { seller: db().settings, buyer: db().customers[0] }).bytes);
    assert.match(text, /prelimin/);
    assert.match(text, /S.dermalm|Södermalm|S\\366dermalm/);
  });

  it("utkastfaktura markeras UTKAST", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const pdf = renderInvoicePdf(inv, { seller: db().settings, buyer: db().customers[0] });
    assert.ok(pdf.filename.includes("utkast"));
    assert.match(pdfText(pdf.bytes), /UTKAST/);
  });

  it("ändrad kundadress ändrar inte utfärdad faktura-PDF", () => {
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 3_000 })],
      rot: null,
    });
    issueInvoice(inv.id);
    updateCustomer("cust-1", { address: "Fel adress 1", city: "Malmö", postalCode: "211 00", name: "Anna Andersson" });
    const stored = getInvoice(inv.id)!;
    const model = invoicePdfModel(stored, { seller: db().settings, buyer: db().customers[0] });
    assert.ok(model.buyerAddress.some((l) => l.includes("Folkungagatan")));
    assert.equal(model.buyerAddress.some((l) => l.includes("Fel adress")), false);
  });
});

describe("Logotyp i PDF", () => {
  it("bäddar in JPEG-logotyp", () => {
    const jpeg = Buffer.from(
      "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffc40014000100000000000000000000000000000008ffc40014100100000000000000000000000000000000ffda00080001000100003f00abffd9",
      "hex"
    );
    const logoDataUrl = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
    reset({ settings: testCompany({ logoDataUrl }) });
    const quote = createQuote(quoteInput());
    const pdf = renderQuotePdf(quote, { seller: db().settings, buyer: db().customers[0] });
    assert.match(pdfText(pdf.bytes), /\/Subtype \/Image/);
    assert.match(pdfText(pdf.bytes), /DCTDecode/);
  });
});
