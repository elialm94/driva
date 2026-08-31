process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCompany, testCustomer } from "./invoices/test-db";
import { createInvoice, discardInvoice, issueInvoice } from "./services/invoices";
import { createQuote, discardQuote, quoteDefaults, quoteSendBlockers, quoteCanSend, assertQuoteReadyToSend, QuoteNotReadyError } from "./services/quotes";
import { collectIssueErrors, getInvoiceSendBlockers, invoiceCanSend } from "./invoices/validate";
import { listInvoicesForTable, listQuotesForTable } from "./services/economy-list";
import { db } from "./store";
import { getInvoice, getQuote } from "./services/data";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function draftQuote(over: { customerId?: string } = {}) {
  const defaults = quoteDefaults();
  return createQuote({
    customerId: over.customerId ?? "cust-1",
    title: "Altan",
    intro: "",
    lines: [labor()],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("faktura-sendblockers: en källa, inga dubbletter", () => {
  beforeEach(() => reset());

  it("saknade betalningsuppgifter ger exakt en blockerare", () => {
    reset({ settings: testCompany({ bankgiro: "", plusgiro: "", iban: "", bankAccount: "" }) });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const blockers = getInvoiceSendBlockers(invoice.id);
    const payment = blockers.filter((b) => /betalningsuppgift/i.test(b.message));
    assert.equal(payment.length, 1);
    assert.equal(payment[0].code, "seller_bankgiro");
    assert.equal(
      collectIssueErrors({ invoice, seller: db().settings, buyer: db().customers[0] }).filter((b) =>
        /betalningsuppgift/i.test(b.message)
      ).length,
      1
    );
  });

  it("canSend och checklistan drivs av samma lista, inklusive kundens e-post", () => {
    reset({
      customers: [testCustomer({ email: "", address: "", postalCode: "", city: "" })],
    });
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const blockers = getInvoiceSendBlockers(invoice.id);
    assert.ok(blockers.some((b) => b.code === "buyer_email"));
    assert.ok(blockers.some((b) => b.code === "buyer_address"));
    assert.equal(invoiceCanSend(invoice.id), false);
    assert.equal(invoiceCanSend(invoice.id), blockers.length === 0);
  });

  it("canSend blir true när sista blockeraren är borta", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    assert.equal(getInvoiceSendBlockers(invoice.id).length, 0);
    assert.equal(invoiceCanSend(invoice.id), true);
  });
});

describe("offert-sendblockers: samma modell som faktura", () => {
  beforeEach(() => reset());

  it("saknad adress + e-post ger båda blockers och canSend false", () => {
    reset({
      settings: testCompany({ address: "", postalCode: "", city: "" }),
      customers: [testCustomer({ email: "" })],
    });
    const quote = draftQuote();
    const blockers = quoteSendBlockers(quote.id);
    assert.ok(blockers.some((b) => b.code === "seller_address"));
    assert.ok(blockers.some((b) => b.code === "buyer_email"));
    assert.equal(quoteCanSend(quote.id), false);
    assert.throws(() => assertQuoteReadyToSend(quote.id), QuoteNotReadyError);
  });

  it("servervalidering använder hela listan inklusive e-post", () => {
    reset({ customers: [testCustomer({ email: "" })] });
    const quote = draftQuote();
    try {
      assertQuoteReadyToSend(quote.id);
      assert.fail("skulle ha stoppats");
    } catch (e) {
      assert.ok(e instanceof QuoteNotReadyError);
      assert.deepEqual(
        e.blockers.map((b) => b.code),
        quoteSendBlockers(quote.id).map((b) => b.code)
      );
    }
  });
});

describe("kasta utkast", () => {
  beforeEach(() => reset());

  it("kastar offertutkast och rensar versioner", () => {
    const quote = draftQuote();
    const id = quote.id;
    discardQuote(id);
    assert.equal(getQuote(id), undefined);
    assert.equal(db().quoteVersions.some((v) => v.quoteId === id), false);
    assert.match(db().activity[0]?.text ?? "", /Offertutkast/);
  });

  it("vägrar kasta skickad offert", () => {
    const quote = draftQuote();
    quote.status = "skickad";
    quote.sentAt = new Date().toISOString();
    assert.throws(() => discardQuote(quote.id), /Skickade offerter/);
    assert.ok(getQuote(quote.id));
  });

  it("kastar fakturautkast men inte utfärdad faktura", () => {
    const draft = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    discardInvoice(draft.id);
    assert.equal(getInvoice(draft.id), undefined);

    const issued = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    issueInvoice(issued.id);
    assert.throws(() => discardInvoice(issued.id), /Utfärdade fakturor/);
    assert.ok(getInvoice(issued.id));
  });
});

describe("ekonomilistan märker utkast", () => {
  beforeEach(() => reset());

  it("offerter och fakturor sätter isDraft bara på utkast", () => {
    const quote = draftQuote();
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const quotes = listQuotesForTable();
    const invoices = listInvoicesForTable();
    assert.equal(quotes.rows.find((r) => r.id === quote.id)?.isDraft, true);
    assert.equal(invoices.rows.find((r) => r.id === invoice.id)?.isDraft, true);
    issueInvoice(invoice.id);
    assert.equal(listInvoicesForTable().rows.find((r) => r.id === invoice.id)?.isDraft, false);
  });
});
