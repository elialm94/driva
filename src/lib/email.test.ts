process.env.DRIVA_TEST = "1";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { MAIL_NOT_CONFIGURED, setMailTransportForTests, type MailMessage } from "./mail";
import { sendQuoteWithEmail, emailInvoice, remindInvoiceByEmail } from "./services/document-mail";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice, issueInvoice } from "./services/invoices";
import { createCustomer, updateCustomer } from "./services/customers";
import { resolveCustomerEmail } from "./resolve-missing-requirements";
import { sendCollaborationInviteEmail } from "./collaboration/mail";
import type { CollaborationInvitation } from "./types";

const sent: MailMessage[] = [];
let failNext = false;
let sendCount = 0;

function draftQuote(customerId: string) {
  const defaults = quoteDefaults();
  return createQuote({
    customerId,
    title: "Altanbygge",
    intro: "",
    lines: [labor({ unitPrice: 12_000 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

function draftInvoice(customerId: string) {
  return createInvoice({
    customerId,
    type: "faktura",
    lines: [labor({ unitPrice: 12_000 })],
    rot: null,
  });
}

beforeEach(() => {
  sent.length = 0;
  failNext = false;
  sendCount = 0;
  delete process.env.RESEND_API_KEY;
  setMailTransportForTests(async (msg) => {
    sendCount += 1;
    if (failNext) {
      failNext = false;
      throw new Error("Resend 403: domain not verified");
    }
    sent.push(msg);
    return { messageId: `msg_${sendCount}` };
  });
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

afterEach(() => {
  setMailTransportForTests(undefined);
  delete process.env.RESEND_API_KEY;
});

describe("offert via Resend", () => {
  it("lyckat utskick markerar skickad och sparar message id", async () => {
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithEmail(quote.id);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.messageId, "msg_1");
    assert.equal(outcome.sentTo, "anna@test.se");
    assert.equal(sent.length, 1);
    assert.match(sent[0].subject, /Offert #1 från Södermalms Snickeri AB/);
    assert.match(sent[0].text, /Visa offert/);
    assert.match(sent[0].html, /\/offert\//);
    assert.equal(sent[0].replyTo, "info@sodermalm.se");

    const stored = db().quotes.find((q) => q.id === quote.id)!;
    assert.equal(stored.status, "skickad");
    assert.ok(stored.sentAt);
    assert.equal(stored.lastEmail?.messageId, "msg_1");
    assert.equal(stored.lastEmail?.sentTo, "anna@test.se");
    assert.equal(stored.lastEmail?.provider, "resend");
  });

  it("Resend-fel lämnar offerten osänd så att man kan försöka igen", async () => {
    failNext = true;
    const quote = draftQuote("cust-1");
    const first = await sendQuoteWithEmail(quote.id);
    assert.equal(first.outcome.ok, false);
    assert.match(first.outcome.error ?? "", /verifierad|Försök igen|Resend/i);
    const afterFail = db().quotes.find((q) => q.id === quote.id)!;
    assert.equal(afterFail.status, "utkast");
    assert.equal(afterFail.sentAt, undefined);
    assert.equal(afterFail.lastEmail, undefined);

    const retry = await sendQuoteWithEmail(quote.id);
    assert.equal(retry.outcome.ok, true);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
  });

  it("saknad e-post: efter komplettering anropas Resend", async () => {
    const sara = createCustomer({
      kind: "privat",
      name: "Sara Nilsson",
      address: "Blekingegatan 34",
      postalCode: "118 56",
      city: "Stockholm",
    });
    const quote = draftQuote(sara.id);
    const before = await sendQuoteWithEmail(quote.id);
    assert.equal(before.outcome.ok, false);
    assert.match(before.outcome.error ?? "", /e-postadress/i);
    assert.equal(sent.length, 0);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");

    const saved = resolveCustomerEmail(sara.id, "sara@example.se");
    assert.equal(saved.ok, true);
    const after = await sendQuoteWithEmail(quote.id);
    assert.equal(after.outcome.ok, true);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, "sara@example.se");
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
  });

  it("dubbelklick skickar bara en gång", async () => {
    const quote = draftQuote("cust-1");
    const [a, b] = await Promise.all([sendQuoteWithEmail(quote.id), sendQuoteWithEmail(quote.id)]);
    assert.equal(a.outcome.ok, true);
    assert.equal(b.outcome.ok, true);
    assert.equal(sendCount, 1);
    assert.equal(sent.length, 1);
    const stored = db().quotes.find((q) => q.id === quote.id)!;
    assert.equal(stored.status, "skickad");
    assert.equal(db().activity.filter((e) => e.text.includes("skickades med e-post")).length, 1);
  });

  it("saknad API-nyckel ger ingen fejkad succé", async () => {
    setMailTransportForTests(undefined);
    delete process.env.RESEND_API_KEY;
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithEmail(quote.id);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, MAIL_NOT_CONFIGURED);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.sentAt, undefined);
  });

  it("okänd offert (annan tenant / påhittat id) blockeras", async () => {
    await assert.rejects(() => sendQuoteWithEmail("quote-annan-tenant"), /finns inte/);
    assert.equal(sent.length, 0);
  });
});

describe("faktura via samma arkitektur", () => {
  it("skickar efter utfärdande och sparar message id", async () => {
    const invoice = draftInvoice("cust-1");
    issueInvoice(invoice.id);
    const { outcome } = await emailInvoice(invoice.id);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.messageId, "msg_1");
    assert.match(sent[0].subject, /Faktura #/);
    assert.match(sent[0].text, /Visa faktura|OCR|Bankgiro/);
    const stored = db().invoices.find((i) => i.id === invoice.id)!;
    assert.ok(stored.sentAt);
    assert.equal(stored.lastEmail?.messageId, "msg_1");
    assert.equal(stored.lastEmail?.sentTo, "anna@test.se");
  });

  it("misslyckad e-post lämnar fakturan osänd", async () => {
    failNext = true;
    const invoice = draftInvoice("cust-1");
    issueInvoice(invoice.id);
    const { outcome } = await emailInvoice(invoice.id);
    assert.equal(outcome.ok, false);
    const stored = db().invoices.find((i) => i.id === invoice.id)!;
    assert.ok(stored.issuedAt);
    assert.equal(stored.sentAt, undefined);
    assert.equal(stored.lastEmail, undefined);
  });
});

describe("betalningspåminnelse", () => {
  it("skickar via Resend efter bekräftad skickad faktura", async () => {
    const invoice = draftInvoice("cust-1");
    issueInvoice(invoice.id);
    const first = await emailInvoice(invoice.id);
    assert.equal(first.outcome.ok, true);
    sent.length = 0;
    const { outcome } = await remindInvoiceByEmail(invoice.id);
    assert.equal(outcome.ok, true);
    assert.match(sent[0].subject, /Påminnelse om faktura/);
    const stored = db().invoices.find((i) => i.id === invoice.id)!;
    assert.equal(stored.reminders.length, 1);
  });
});

describe("samarbetsinbjudan", () => {
  it("använder Resend", async () => {
    const invitation: CollaborationInvitation = {
      id: "inv-1",
      businessId: "biz-a",
      email: "anna@byran.se",
      role: "accounting_consultant",
      invitedByUserId: "user-owner",
      invitedByName: "Erik Bygg",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 14 * 86400000).toISOString(),
      status: "pending",
      createdAt: new Date().toISOString(),
    };
    const result = await sendCollaborationInviteEmail({
      invitation,
      token: "token-abc",
      companyName: "Södermalms Snickeri AB",
    });
    assert.equal(result.ok, true);
    assert.equal(result.messageId, "msg_1");
    assert.equal(sent[0].to, "anna@byran.se");
    assert.match(sent[0].subject, /bjuder in dig/);
    assert.match(sent[0].text, /inbjudan/);
  });
});

describe("komplettering på kunden", () => {
  it("updateCustomer + sendQuoteWithEmail är samma kedja som UI:t återupptar", async () => {
    const erik = createCustomer({
      kind: "privat",
      name: "Erik",
      address: "Gatan 1",
      postalCode: "111 22",
      city: "Stockholm",
    });
    const quote = draftQuote(erik.id);
    updateCustomer(erik.id, { email: "erik@example.se" });
    const { outcome } = await sendQuoteWithEmail(quote.id);
    assert.equal(outcome.ok, true);
    assert.equal(sent[0].to, "erik@example.se");
  });
});
