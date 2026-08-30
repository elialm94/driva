process.env.DRIVA_TEST = "1";

/**
 * Kundfacing dokumenthierarki: beskrivning (rik text) före prisrader,
 * utan generisk "Övrig information"-rubrik. InvoiceDocument och QuoteDocument
 * är den enda layouten för preview, kundvy, BankID-vy och PDF.
 */

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceDocument } from "../components/invoice-document";
import { QuoteDocument } from "../components/quote-document";
import { RichTextView } from "../components/rich-text";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { createInvoice } from "./services/invoices";
import { createQuote } from "./services/quotes";
import { currentVersion } from "./services/data";
import type { RichTextDoc } from "./richtext";

const DESC_HEADING = "Ingår i underlaget";
const DESC_BODY = "Målning av tak och väggar.";
const LINE_TEXT = "Snickeriarbete-RADTEST";

const descriptionDoc: RichTextDoc = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: DESC_HEADING }] },
    { type: "paragraph", content: [{ type: "text", text: DESC_BODY }] },
  ],
};

const paragraphOnlyDoc: RichTextDoc = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: DESC_BODY }] }],
};

const listThenDividerDoc: RichTextDoc = {
  type: "doc",
  content: [
    {
      type: "bulletList",
      content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Material" }] }] }],
    },
    { type: "horizontalRule" },
    { type: "paragraph", content: [{ type: "text", text: "Efter avdelaren" }] },
  ],
};

function indexOf(html: string, needle: string): number {
  const i = html.indexOf(needle);
  assert.ok(i !== -1, `förväntade att hitta "${needle}" i dokument-HTML`);
  return i;
}

describe("RichTextView: tomt / ingen generisk rubrik / avdelare", () => {
  it("renderar ingenting för tomt eller saknat dokument", () => {
    assert.equal(renderToStaticMarkup(createElement(RichTextView, { doc: undefined })), "");
    assert.equal(renderToStaticMarkup(createElement(RichTextView, { doc: null })), "");
    assert.equal(
      renderToStaticMarkup(createElement(RichTextView, { doc: { type: "doc", content: [{ type: "paragraph" }] } })),
      ""
    );
  });

  it("lägger inte till generisk rubrik – egna H2 eller bara brödtext", () => {
    const withHeading = renderToStaticMarkup(createElement(RichTextView, { doc: descriptionDoc }));
    assert.ok(withHeading.includes(DESC_HEADING));
    assert.ok(!withHeading.toLowerCase().includes("övrig information"));
    assert.match(withHeading, /<h2>/);

    const paragraph = renderToStaticMarkup(createElement(RichTextView, { doc: paragraphOnlyDoc }));
    assert.ok(paragraph.includes(DESC_BODY));
    assert.ok(!paragraph.includes("<h1"));
    assert.ok(!paragraph.includes("<h2"));
    assert.ok(!paragraph.includes("<h3"));
    assert.ok(!paragraph.toLowerCase().includes("övrig information"));
  });

  it("lista → avdelare → stycke är syskon på rotnivå, inte kvar i listan", () => {
    const html = renderToStaticMarkup(createElement(RichTextView, { doc: listThenDividerDoc }));
    const ulEnd = html.indexOf("</ul>");
    const hr = html.indexOf("<hr");
    const after = html.indexOf("Efter avdelaren");
    assert.ok(ulEnd !== -1 && hr !== -1 && after !== -1);
    assert.ok(ulEnd < hr && hr < after, "hr och stycke ska komma efter listan, inte inuti den");
    const listHtml = html.slice(html.indexOf("<ul"), ulEnd);
    assert.ok(!listHtml.includes("<hr"), "avdelaren får inte ligga kvar i listan");
  });
});

describe("InvoiceDocument: beskrivning före rader", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("placerar rik text före raderna och utelämnar generisk rubrik", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ description: LINE_TEXT, unitPrice: 8000 })],
      rot: null,
      richText: descriptionDoc,
    });
    const html = renderToStaticMarkup(
      createElement(InvoiceDocument, {
        company: db().settings,
        customer: db().customers[0],
        invoice,
      })
    );
    assert.ok(indexOf(html, DESC_HEADING) < indexOf(html, LINE_TEXT));
    assert.ok(indexOf(html, DESC_BODY) < indexOf(html, LINE_TEXT));
    assert.ok(indexOf(html, LINE_TEXT) < indexOf(html, "Att betala nu"));
    assert.ok(!html.includes("Övrig information"));
    assert.ok(!html.includes("ÖVRIG INFORMATION"));
  });

  it("utelämnar beskrivningsblocket helt när rik text saknas", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ description: LINE_TEXT })],
      rot: null,
    });
    const html = renderToStaticMarkup(
      createElement(InvoiceDocument, {
        company: db().settings,
        customer: db().customers[0],
        invoice,
      })
    );
    assert.ok(!html.includes("richtext-doc"));
    assert.ok(!html.includes("Övrig information"));
    assert.ok(html.includes(LINE_TEXT));
  });
});

describe("QuoteDocument: beskrivning före rader", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  it("placerar titel → beskrivning → rader, utan generisk rubrik", () => {
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      intro: "Kort ingress.",
      lines: [labor({ description: LINE_TEXT, unitPrice: 8000 })],
      rot: null,
      paymentPlan: [{ label: "Allt", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Egna villkor.",
      richText: descriptionDoc,
    });
    const html = renderToStaticMarkup(
      createElement(QuoteDocument, {
        company: db().settings,
        customer: db().customers[0],
        quote,
        version: currentVersion(quote),
      })
    );
    assert.ok(indexOf(html, "Altan") < indexOf(html, DESC_HEADING));
    assert.ok(indexOf(html, DESC_HEADING) < indexOf(html, LINE_TEXT));
    assert.ok(indexOf(html, DESC_BODY) < indexOf(html, LINE_TEXT));
    assert.ok(indexOf(html, LINE_TEXT) < indexOf(html, "Att betala"));
    assert.ok(!html.includes("Övrig information"));
    assert.ok(!html.includes("ÖVRIG INFORMATION"));
  });

  it("utelämnar beskrivningsblocket helt när rik text saknas", () => {
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      intro: "Kort ingress.",
      lines: [labor({ description: LINE_TEXT })],
      rot: null,
      paymentPlan: [{ label: "Allt", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2099-01-01",
      terms: "Egna villkor.",
    });
    const html = renderToStaticMarkup(
      createElement(QuoteDocument, {
        company: db().settings,
        customer: db().customers[0],
        quote,
        version: currentVersion(quote),
      })
    );
    assert.ok(!html.includes("richtext-doc"));
    assert.ok(!html.includes("Övrig information"));
    assert.ok(html.includes(LINE_TEXT));
  });
});

/**
 * Kunden ska kunna läsa hela avtalet den accepterar utan att undra om något
 * låg bakom "Visa mer": inga <details>, inga modaler, inga accordions i de
 * kundfacing dokumenten. Kompakteringen sker i typografi och spacing.
 */
describe("Kundfacing dokument: allt avtalsinnehåll är synligt direkt", () => {
  beforeEach(() => replaceDb(emptyTestDb()));

  const TERMS = "Egna villkor gäller.\nGaranti lämnas enligt konsumenttjänstlagen.";

  function rotQuote(over: { paymentPlan?: { label: string; percent: number }[] } = {}) {
    return createQuote({
      customerId: "cust-1",
      title: "Badrum",
      intro: "Kort ingress.",
      lines: [labor({ description: LINE_TEXT, unitPrice: 20000 })],
      rot: { type: "rot" },
      paymentPlan: over.paymentPlan ?? [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      lateInterestRate: 10,
      validUntil: "2099-01-01",
      terms: TERMS,
    });
  }

  function quoteHtml(quote: ReturnType<typeof createQuote>) {
    return renderToStaticMarkup(
      createElement(QuoteDocument, {
        company: db().settings,
        customer: db().customers[0],
        quote,
        version: currentVersion(quote),
      })
    );
  }

  it("offert: villkor, ROT-klausul, betalning och signering står i klartext", () => {
    const html = quoteHtml(rotQuote());
    assert.ok(html.includes("Garanti lämnas enligt konsumenttjänstlagen"), "villkorstexten ska stå på dokumentet");
    assert.ok(html.includes("preliminärt och förutsätter att Skatteverket"), "ROT-klausulen ska stå på dokumentet");
    assert.ok(html.includes("Preliminärt ROT-avdrag"));
    assert.ok(html.includes("Betalningsvillkor: 30 dagar"));
    assert.ok(html.includes("dröjsmålsränta med 10 % per år"));
    assert.ok(html.includes("Godkänn offerten"));
    assert.ok(html.includes("BankID"));
  });

  it("offert: ingen avtalstext bakom expand, modal eller accordion", () => {
    const html = quoteHtml(rotQuote());
    assert.ok(!html.includes("<details"), "dokumentet får inte ha kollapsat innehåll");
    assert.ok(!html.includes("<summary"));
    assert.ok(!html.toLowerCase().includes("visa fullständiga villkor"));
    assert.ok(!html.toLowerCase().includes("visa mer"));
    assert.ok(!html.includes("Hur räknas detta?"), "räkneexemplet ska stå som synlig not, inte bakom en expand");
  });

  it("offert utan betalningsplan visar ändå betalning och betalningsvillkor", () => {
    const html = quoteHtml(rotQuote({ paymentPlan: [] }));
    assert.ok(html.includes("Betalning"));
    assert.ok(html.includes("Hela beloppet (100 %)"));
    assert.ok(html.includes("Betalningsvillkor: 30 dagar"));
  });

  it("faktura: ROT-disclaimer syns och inget ligger bakom expand", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ description: LINE_TEXT, unitPrice: 20000 })],
      rot: { type: "rot" },
    });
    const html = renderToStaticMarkup(
      createElement(InvoiceDocument, {
        company: db().settings,
        customer: db().customers[0],
        invoice,
      })
    );
    assert.ok(html.includes("ROT/RUT är preliminärt"));
    assert.ok(html.includes("Att betala nu"));
    assert.ok(html.includes("Betalning"));
    assert.ok(!html.includes("<details"));
    assert.ok(!html.includes("<summary"));
  });
});
