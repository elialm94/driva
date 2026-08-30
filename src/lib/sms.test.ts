process.env.DRIVA_TEST = "1";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { setSmsTestTransport, sendSms } from "./sms/service";
import { SMS_FROM, SMS_INVALID_PHONE } from "./sms/config";
import { defaultReminderChannels, defaultSendChannels } from "./sms/channels";
import {
  sendQuoteWithChannels,
  sendQuoteWithEmail,
  emailInvoice,
  deliverInvoiceWithChannels,
  remindInvoiceWithChannels,
} from "./services/document-mail";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice, issueInvoice } from "./services/invoices";
import { createCustomer, updateCustomer } from "./services/customers";
import { quoteDeliverySteps, invoiceDeliverySteps } from "./services/deliveries";

const mailed: MailMessage[] = [];
const texts: { to: string; message: string }[] = [];
let failSms = false;
let fetchCalls = 0;
const originalFetch = globalThis.fetch;

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
  mailed.length = 0;
  texts.length = 0;
  failSms = false;
  fetchCalls = 0;
  delete process.env.ELKS_API_USERNAME;
  delete process.env.ELKS_API_PASSWORD;
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("46elks ska inte anropas i test");
  }) as typeof fetch;
  setMailTransportForTests(async (msg) => {
    mailed.push(msg);
    return { messageId: `msg_${mailed.length}` };
  });
  setSmsTestTransport(async (msg) => {
    if (failSms) {
      failSms = false;
      throw new Error("46elks 400");
    }
    texts.push(msg);
    return { providerMessageId: `sms_${texts.length}` };
  });
  replaceDb(
    emptyTestDb({
      settings: {
        ...emptyTestDb().settings,
        name: "Södermalms Snickeri",
        email: "info@sodermalm.se",
        bankgiro: "5678-1234",
      },
      customers: [testCustomer({ email: "anna@test.se", phone: "070-123 45 67" })],
    })
  );
});

afterEach(() => {
  setMailTransportForTests(undefined);
  setSmsTestTransport(undefined);
  globalThis.fetch = originalFetch;
  delete process.env.ELKS_API_USERNAME;
  delete process.env.ELKS_API_PASSWORD;
});

describe("SMS-text och kanaldefault", () => {
  it("e-post + telefon defaultar till e-post, SMS valbart", () => {
    assert.deepEqual(defaultSendChannels("anna@test.se", "070-123 45 67"), { email: true, sms: false });
    assert.deepEqual(defaultSendChannels("", "070-123 45 67"), { email: false, sms: true });
    assert.deepEqual(defaultSendChannels("anna@test.se", ""), { email: true, sms: false });
  });

  it("påminnelse återanvänder senaste skick-kanalerna", () => {
    const invoice = {
      lastEmail: { provider: "resend" as const, messageId: "m", sentTo: "anna@test.se" },
      deliveries: [
        {
          channel: "EMAIL" as const,
          kind: "send" as const,
          destination: "anna@test.se",
          provider: "resend" as const,
          sentAt: "2026-08-30T15:42:00.000Z",
          status: "sent" as const,
        },
        {
          channel: "SMS" as const,
          kind: "send" as const,
          destination: "+46701234567",
          provider: "46elks" as const,
          sentAt: "2026-08-30T15:42:00.000Z",
          status: "sent" as const,
        },
      ],
    };
    assert.deepEqual(defaultReminderChannels(invoice, { email: "anna@test.se", phone: "070-123 45 67" }), {
      email: true,
      sms: true,
    });
  });
});

describe("Test A – e-post + SMS samtidigt", () => {
  it("skickar båda och tidslinjen visar båda kanalerna", async () => {
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithChannels(quote.id, { email: true, sms: true });
    assert.equal(outcome.ok, true);
    assert.equal(mailed.length, 1);
    assert.equal(texts.length, 1);
    assert.equal(texts[0].to, "+46701234567");
    assert.match(texts[0].message, /Södermalms Snickeri har skickat en offert/);
    assert.match(texts[0].message, /\/offert\//);
    assert.equal(fetchCalls, 0);

    const stored = db().quotes.find((q) => q.id === quote.id)!;
    assert.equal(stored.status, "skickad");
    assert.equal(stored.lastEmail?.sentTo, "anna@test.se");
    const channels = (stored.deliveries ?? []).map((d) => `${d.channel}:${d.status}`);
    assert.deepEqual(channels, ["EMAIL:sent", "SMS:sent"]);
    const labels = quoteDeliverySteps(stored).map((s) => s.label);
    assert.ok(labels.includes("Skickad via e-post"));
    assert.ok(labels.includes("Skickad via SMS"));
  });

  it("partial success rullar inte tillbaka e-post", async () => {
    failSms = true;
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithChannels(quote.id, { email: true, sms: true });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.warning, "E-post skickades, men SMS kunde inte skickas.");
    const stored = db().quotes.find((q) => q.id === quote.id)!;
    assert.equal(stored.status, "skickad");
    assert.equal(stored.lastEmail?.messageId, "msg_1");
    assert.equal(stored.deliveries?.find((d) => d.channel === "SMS")?.status, "failed");
  });
});

describe("Test B – endast telefon", () => {
  it("SMS kan skickas utan e-post", async () => {
    const maja = createCustomer({ kind: "privat", name: "Maja", phone: "070-123 45 67" });
    const quote = draftQuote(maja.id);
    const { outcome } = await sendQuoteWithChannels(quote.id, { email: false, sms: true });
    assert.equal(outcome.ok, true);
    assert.equal(mailed.length, 0);
    assert.equal(texts.length, 1);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.lastEmail, undefined);
  });
});

describe("Test C – endast e-post", () => {
  it("befintligt e-postflöde fungerar", async () => {
    updateCustomer("cust-1", { phone: "" });
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithEmail(quote.id);
    assert.equal(outcome.ok, true);
    assert.equal(mailed.length, 1);
    assert.equal(texts.length, 0);
  });
});

describe("Test D – faktura och påminnelse", () => {
  it("SMS finns som kanal för faktura och påminnelse", async () => {
    const invoice = draftInvoice("cust-1");
    issueInvoice(invoice.id);
    const sent = await deliverInvoiceWithChannels(invoice.id, { email: true, sms: true });
    assert.equal(sent.outcome.ok, true);
    assert.equal(texts.length, 1);
    assert.match(texts[0].message, /har skickat en faktura/);
    assert.match(texts[0].message, /\/faktura\//);

    texts.length = 0;
    mailed.length = 0;
    const reminder = await remindInvoiceWithChannels(invoice.id, { email: false, sms: true });
    assert.equal(reminder.outcome.ok, true);
    assert.equal(mailed.length, 0);
    assert.equal(texts.length, 1);
    assert.match(texts[0].message, /påminner om faktura #/);
    const stored = db().invoices.find((i) => i.id === invoice.id)!;
    assert.equal(stored.reminders.length, 1);
    const labels = invoiceDeliverySteps(stored).map((s) => s.label);
    assert.ok(labels.includes("Skickad via e-post"));
    assert.ok(labels.includes("Skickad via SMS"));
    assert.ok(labels.includes("Påminnelse skickad via SMS"));
  });
});

describe("Test E – ogiltigt telefonnummer", () => {
  it("blockerar SMS med svensk feedback", async () => {
    updateCustomer("cust-1", { phone: "123" });
    const quote = draftQuote("cust-1");
    const { outcome } = await sendQuoteWithChannels(quote.id, { email: false, sms: true });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error, SMS_INVALID_PHONE);
    assert.equal(texts.length, 0);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");
  });
});

describe("Test F – demo skickar inte riktiga SMS", () => {
  it("simulerar SMS och anropar inte 46elks", async () => {
    setSmsTestTransport(undefined);
    process.env.ELKS_API_USERNAME = "u";
    process.env.ELKS_API_PASSWORD = "p";
    replaceDb(
      emptyTestDb({
        settings: { ...emptyTestDb().settings, name: "Södermalms Snickeri" },
        customers: [testCustomer()],
        meta: { seededAt: new Date().toISOString(), demo: true },
      })
    );
    const result = await sendSms({ to: "+46701234567", message: "hej" });
    assert.equal(result.ok, true);
    assert.equal(result.mode, "demo");
    assert.equal(fetchCalls, 0);
  });
});

describe("46elks-avsändare", () => {
  it("är centraliserad till Driva", () => {
    assert.equal(SMS_FROM, "Driva");
  });
});
