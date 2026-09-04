process.env.DRIVA_TEST = "1";

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  prepareInvoiceMail,
  prepareInvoiceReminderMail,
  prepareQuoteFollowUpMail,
  prepareQuoteMail,
} from "./email/service";
import { invoiceEmailRubrik } from "./email/rubrik";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice } from "./services/invoices";
import { createJob } from "./services/jobs";
import { plainTextToRichText } from "./quote-description";

beforeEach(() => {
  replaceDb(
    emptyTestDb({
      settings: {
        ...emptyTestDb().settings,
        name: "Södermalms Snickeri AB",
        email: "info@sodermalm.se",
        bankgiro: "5678-1234",
      },
      customers: [testCustomer({ email: "anna@test.se" })],
    })
  );
});

describe("prepareQuoteMail", () => {
  it("ämne är Offert från {företag} – {rubrik}, utan #n", () => {
    const mail = prepareQuoteMail({
      to: "anna@test.se",
      quoteId: "q1",
      quoteNumber: 115,
      title: "Fasadarbete",
      customerName: "Anna Andersson",
      amount: 26_000,
      validUntil: "2026-10-01",
      token: "tok",
    });
    assert.equal(mail.subject, "Offert från Södermalms Snickeri AB – Fasadarbete");
    assert.doesNotMatch(mail.subject, /#\d+/);
    assert.match(mail.text, /offert #115/);
  });
});

describe("prepareInvoiceMail", () => {
  it("ämne är Faktura från {företag} – {rubrik}, utan #n", () => {
    const mail = prepareInvoiceMail({
      to: "anna@test.se",
      invoiceId: "inv-1",
      invoiceNumber: 1042,
      title: "Köksrenovering",
      customerName: "Anna Andersson",
      amount: 12_000,
      dueDate: "2026-10-15",
      token: "tok",
      ocr: "10421",
    });
    assert.equal(mail.subject, "Faktura från Södermalms Snickeri AB – Köksrenovering");
    assert.doesNotMatch(mail.subject, /#\d+/);
    assert.match(mail.text, /faktura #1042/);
    assert.match(mail.text, /OCR: 10421/);
    assert.match(mail.text, /Bankgiro: 5678-1234/);
    assert.match(mail.text, /Förfallodatum/);
  });
});

describe("prepareInvoiceReminderMail", () => {
  it("ämne är Påminnelse: faktura från {företag} – {rubrik}", () => {
    const mail = prepareInvoiceReminderMail({
      to: "anna@test.se",
      invoiceId: "inv-1",
      invoiceNumber: 1042,
      title: "Köksrenovering",
      customerName: "Anna Andersson",
      amount: 12_000,
      outstanding: 12_000,
      dueDate: "2026-09-01",
      token: "tok",
      ocr: "10421",
    });
    assert.equal(mail.subject, "Påminnelse: faktura från Södermalms Snickeri AB – Köksrenovering");
    assert.doesNotMatch(mail.subject, /#\d+/);
    assert.match(mail.text, /faktura #1042/);
  });
});

describe("prepareQuoteFollowUpMail", () => {
  it("ämne är Påminnelse: offert från {företag} – {rubrik}", () => {
    const mail = prepareQuoteFollowUpMail({
      to: "anna@test.se",
      quoteId: "q1",
      quoteNumber: 115,
      title: "Fasadarbete",
      customerName: "Anna Andersson",
      validUntil: "2026-10-01",
      token: "tok",
    });
    assert.equal(mail.subject, "Påminnelse: offert från Södermalms Snickeri AB – Fasadarbete");
    assert.doesNotMatch(mail.subject, /#\d+/);
  });
});

describe("invoiceEmailRubrik", () => {
  it("använder offertens titel när fakturan är kopplad", () => {
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "Fasadarbete",
      lines: [labor({ description: "Annat arbete" })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    const invoice = createInvoice({
      customerId: "cust-1",
      quoteId: quote.id,
      type: "faktura",
      lines: [labor({ description: "Annat arbete" })],
      rot: null,
    });
    assert.equal(invoiceEmailRubrik(invoice), "Fasadarbete");
  });

  it("faller tillbaka på första radens beskrivning", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ description: "Snickeriarbete" })],
      rot: null,
    });
    assert.equal(invoiceEmailRubrik(invoice), "Snickeriarbete");
  });

  it("faller tillbaka på uppdragets titel när rader saknas", () => {
    const job = createJob({ customerId: "cust-1", title: "Köksrenovering" });
    const invoice = createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      type: "faktura",
      lines: [],
      rot: null,
    });
    assert.equal(invoiceEmailRubrik(invoice), "Köksrenovering");
  });

  it("faller tillbaka på första raden i övrig information", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [],
      rot: null,
      richText: plainTextToRichText("Renovering av altan enligt överenskommelse."),
    });
    assert.equal(invoiceEmailRubrik(invoice), "Renovering av altan enligt överenskommelse.");
  });

  it("sista utväg är dokumenttypen utan nummer", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [],
      rot: null,
    });
    assert.equal(invoiceEmailRubrik(invoice), "Faktura");
  });
});
