process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { createCustomer, updateCustomer } from "./services/customers";
import { createInvoice, issueInvoice } from "./services/invoices";
import { createQuote, quoteDefaults, sendQuote } from "./services/quotes";
import { requireCustomer } from "./services/data";
import {
  EMAIL_SAVE_FAILED,
  createBlockedActionSession,
  emailInputError,
  missingEmailDialogCopy,
  nextAfterResolve,
  type PendingAction,
} from "./missing-requirements";
import { resolveCustomerEmail } from "./resolve-missing-requirements";

function reset() {
  replaceDb(emptyTestDb({ customers: [] }));
}

function customerWithoutEmail(name = "Sara Nilsson") {
  return createCustomer({
    kind: "privat",
    name,
    address: "Blekingegatan 34",
    postalCode: "118 56",
    city: "Stockholm",
  });
}

function draftInvoice(customerId: string) {
  return createInvoice({
    customerId,
    type: "faktura",
    lines: [labor({ unitPrice: 12_000_00 })],
    rot: null,
  });
}

function draftQuote(customerId: string) {
  const defaults = quoteDefaults();
  return createQuote({
    customerId,
    title: "Altanbygge",
    lines: [labor({ unitPrice: 12_000_00 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("e-postfält i saknad-krav-dialogen", () => {
  it("tomt och ogiltigt ger de exakta texterna", () => {
    assert.equal(emailInputError(""), "Skriv in kundens e-postadress.");
    assert.equal(emailInputError("   "), "Skriv in kundens e-postadress.");
    assert.equal(emailInputError("sara"), "Ange en giltig e-postadress.");
    assert.equal(emailInputError("sara@example.se"), null);
  });

  it("kopian följer den blockerade åtgärden", () => {
    assert.equal(missingEmailDialogCopy("SEND_INVOICE").title, "Kunden saknar e-postadress");
    assert.match(missingEmailDialogCopy("SEND_INVOICE").description, /fakturan/);
    assert.match(missingEmailDialogCopy("SEND_QUOTE").description, /offerten/);
  });
});

describe("skicka faktura när kunden saknar e-post", () => {
  it("Send → dialog → giltig e-post → sparas på kunden → skickflödet återupptas", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    const pending: PendingAction = { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id };
    const resumed: string[] = [];

    assert.deepEqual(nextAfterResolve(pending, sara), { type: "collect", field: "buyer_email" });

    const session = createBlockedActionSession({
      action: pending,
      customerEmail: sara.email,
      persist: resolveCustomerEmail,
      onResume: (resolved) => resumed.push(resolved.email),
    });

    assert.deepEqual(session.request(), { status: "collecting", field: "buyer_email" });
    session.setInput("sara@example.se");
    assert.deepEqual(session.resolve(), { status: "resumed", email: "sara@example.se" });

    const stored = requireCustomer(sara.id);
    assert.equal(stored.email, "sara@example.se");
    assert.deepEqual(resumed, ["sara@example.se"]);
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "utkast");

    const after = nextAfterResolve(pending, stored);
    assert.deepEqual(after, { type: "resume", action: pending });

    issueInvoice(invoice.id);
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "skickad");
  });

  it("Avbryt skickar ingenting och lämnar utkastet orört", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    const resumed: string[] = [];
    const session = createBlockedActionSession({
      action: { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id },
      customerEmail: sara.email,
      persist: resolveCustomerEmail,
      onResume: (resolved) => resumed.push(resolved.email),
    });

    session.request();
    session.setInput("sara@example.se");
    assert.equal(session.cancel().status, "idle");

    assert.equal(requireCustomer(sara.id).email, "");
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "utkast");
    assert.deepEqual(resumed, []);
  });

  it("ogiltig e-post blockerar och sparar inte", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    const session = createBlockedActionSession({
      action: { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id },
      customerEmail: sara.email,
      persist: resolveCustomerEmail,
      onResume: () => {
        throw new Error("ska inte återuppta");
      },
    });

    session.request();
    session.setInput("inte-en-adress");
    const step = session.resolve();
    assert.deepEqual(step, { status: "invalid", error: "Ange en giltig e-postadress." });
    assert.equal(requireCustomer(sara.id).email, "");
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "utkast");
  });

  it("sparfel skickar inte fakturan och behåller det inskrivna värdet", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    const session = createBlockedActionSession({
      action: { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id },
      customerEmail: sara.email,
      persist: () => {
        throw new Error("disk");
      },
      onResume: () => {
        throw new Error("ska inte återuppta");
      },
    });

    session.request();
    session.setInput("sara@example.se");
    const step = session.resolve();
    assert.deepEqual(step, { status: "failed", error: EMAIL_SAVE_FAILED, input: "sara@example.se" });
    assert.equal(session.input, "sara@example.se");
    assert.equal(requireCustomer(sara.id).email, "");
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "utkast");
  });

  it("saknad kund ger samma sparfel via resolveCustomerEmail", () => {
    reset();
    const result = resolveCustomerEmail("finns-inte", "sara@example.se");
    assert.deepEqual(result, { ok: false, error: EMAIL_SAVE_FAILED });
  });

  it("dubbelklick under persist muterar inte två gånger och skickar inte", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    let persistCalls = 0;
    let nested: ReturnType<ReturnType<typeof createBlockedActionSession>["resolve"]> | undefined;
    const resumed: string[] = [];

    const session = createBlockedActionSession({
      action: { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id },
      customerEmail: sara.email,
      persist: (customerId, email) => {
        persistCalls += 1;
        nested = session.resolve();
        return resolveCustomerEmail(customerId, email);
      },
      onResume: (resolved) => resumed.push(resolved.email),
    });

    session.request();
    session.setInput("sara@example.se");
    const first = session.resolve();
    assert.deepEqual(nested, { status: "busy" });
    assert.deepEqual(first, { status: "resumed", email: "sara@example.se" });
    assert.equal(persistCalls, 1);
    assert.deepEqual(resumed, ["sara@example.se"]);
    assert.equal(db().invoices.find((i) => i.id === invoice.id)?.status, "utkast");
  });

  it("omläsning av kunden behåller den sparade e-posten", () => {
    reset();
    const sara = customerWithoutEmail();
    const invoice = draftInvoice(sara.id);
    const session = createBlockedActionSession({
      action: { kind: "SEND_INVOICE", documentId: invoice.id, customerId: sara.id },
      customerEmail: sara.email,
      persist: resolveCustomerEmail,
      onResume: () => {},
    });
    session.request();
    session.setInput("sara@example.se");
    session.resolve();

    const reread = db().customers.find((c) => c.id === sara.id);
    assert.equal(reread?.email, "sara@example.se");
    // Samma persistade kund – ingen dokumentkopia.
    const again = requireCustomer(sara.id);
    assert.equal(again.email, "sara@example.se");
    assert.equal(again.id, sara.id);
  });
});

describe("skicka offert när kunden saknar e-post", () => {
  it("samma resolve → persist → resume-flöde", () => {
    reset();
    const sara = customerWithoutEmail();
    const quote = draftQuote(sara.id);
    const pending: PendingAction = { kind: "SEND_QUOTE", documentId: quote.id, customerId: sara.id };
    const resumed: string[] = [];

    const session = createBlockedActionSession({
      action: pending,
      customerEmail: sara.email,
      persist: resolveCustomerEmail,
      onResume: (resolved) => resumed.push(resolved.email),
    });

    assert.deepEqual(session.request(), { status: "collecting", field: "buyer_email" });
    session.setInput("sara@example.se");
    assert.deepEqual(session.resolve(), { status: "resumed", email: "sara@example.se" });
    assert.equal(requireCustomer(sara.id).email, "sara@example.se");
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");
    assert.deepEqual(resumed, ["sara@example.se"]);

    sendQuote(quote.id);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
  });
});

describe("resolveCustomerEmail", () => {
  it("skriver på den riktiga kunden och överlever omläsning", () => {
    reset();
    const sara = customerWithoutEmail();
    const result = resolveCustomerEmail(sara.id, "  sara@example.se  ");
    assert.deepEqual(result, { ok: true, email: "sara@example.se", customerId: sara.id });
    assert.equal(requireCustomer(sara.id).email, "sara@example.se");
    updateCustomer(sara.id, { phone: "070-111 22 33" });
    assert.equal(requireCustomer(sara.id).email, "sara@example.se");
  });
});
