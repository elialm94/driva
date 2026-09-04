process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { DocLine, Invoice } from "../types";
import {
  invoiceHasIssuedListNumber,
  invoiceListTitle,
  invoiceListTypeLabel,
} from "./display";

function line(description: string, unitPrice = 1000): DocLine {
  return {
    id: `line-${description || "empty"}`,
    kind: "material",
    description,
    qty: 1,
    unit: "st",
    unitPrice,
    vatRate: 25,
  };
}

type InvoiceListShape = Pick<Invoice, "number" | "status" | "type" | "lines">;

function invoice(over: Partial<InvoiceListShape> = {}): InvoiceListShape {
  return {
    number: null,
    status: "utkast",
    type: "faktura",
    lines: [],
    ...over,
  };
}

describe("invoiceListTitle", () => {
  it("utfärdad: #n, och Kredit som typetikett på kreditnota", () => {
    const issued = invoice({ number: 1042, status: "skickad", type: "kredit", lines: [line("Återföring")] });
    assert.equal(invoiceListTitle(issued), "#1042");
    assert.equal(invoiceListTypeLabel(issued.type), "Kredit");
    assert.equal(invoiceHasIssuedListNumber(issued), true);
  });

  it("utkast med rubrik (offert / uppdrag / faktura) vinner över radtext", () => {
    const draft = invoice({ lines: [line("Skruv och mutter")] });
    assert.equal(
      invoiceListTitle(draft, {
        quoteTitle: "Platsbyggd bokhylla",
        jobTitle: "Bokhylla",
        invoiceTitle: "Hylla Eli",
      }),
      "Hylla Eli"
    );
    assert.equal(
      invoiceListTitle(draft, { quoteTitle: "Platsbyggd bokhylla", jobTitle: "Bokhylla" }),
      "Platsbyggd bokhylla"
    );
    assert.equal(invoiceListTitle(draft, { jobTitle: "Bokhylla" }), "Bokhylla");
  });

  it("utkast utan rubrik: första icke-tomma radbeskrivningen", () => {
    const draft = invoice({
      lines: [line("   "), line("Ekfanér 20 mm"), line("Beslag")],
    });
    assert.equal(invoiceListTitle(draft, { customerName: "Eli" }), "Ekfanér 20 mm");
  });

  it("utkast utan rubrik och rader: Faktura till {kund}", () => {
    assert.equal(invoiceListTitle(invoice(), { customerName: "Eli" }), "Faktura till Eli");
    assert.equal(invoiceListTitle(invoice({ lines: [line("")] }), { customerName: "  Eli  " }), "Faktura till Eli");
  });

  it("0 kr-utkast visar materialnamn, inte Utkast", () => {
    const draft = invoice({ lines: [line("Beslag och ny trälist", 0)] });
    const title = invoiceListTitle(draft, { customerName: "Eli" });
    assert.equal(title, "Beslag och ny trälist");
    assert.notEqual(title, "Utkast");
    assert.equal(invoiceHasIssuedListNumber(draft), false);
  });

  it("Delbetalning bara när typen är delbetalning", () => {
    const ordinary = invoice({ lines: [line("Delbetalning 1 av 2 – text på raden")] });
    assert.equal(invoiceListTitle(ordinary), "Delbetalning 1 av 2 – text på raden");
    assert.equal(invoiceListTypeLabel(ordinary.type), "");
    assert.equal(invoiceListTypeLabel("delbetalning"), "Delbetalning");
    assert.equal(invoiceListTypeLabel("slutfaktura"), "Slutfaktura");
    assert.equal(invoiceListTypeLabel("faktura"), "");
  });

  it("två utkast till samma kund får olika titlar", () => {
    const a = invoiceListTitle(invoice({ lines: [line("Luckor i ek", 0)] }), { customerName: "Eli" });
    const b = invoiceListTitle(invoice({ lines: [line("Bänkskiva i ask", 0)] }), { customerName: "Eli" });
    assert.equal(a, "Luckor i ek");
    assert.equal(b, "Bänkskiva i ask");
    assert.notEqual(a, b);
    assert.notEqual(a, "Utkast");
    assert.notEqual(b, "Utkast");
  });

  it("tilldelar inte fakturanummer till utkast – även om number råkar vara satt", () => {
    const legacyDraft = invoice({ number: 1048, status: "utkast", lines: [line("Lagning av portparti")] });
    assert.equal(invoiceListTitle(legacyDraft, { customerName: "Brf Eken" }), "Lagning av portparti");
    assert.equal(invoiceHasIssuedListNumber(legacyDraft), false);
  });
});
