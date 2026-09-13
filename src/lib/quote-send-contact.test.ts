process.env.DRIVA_TEST = "1";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { replaceDb, db } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createCustomer, updateCustomer } from "./services/customers";
import {
  createQuote,
  quoteDefaults,
  quoteHardSendBlockers,
  quoteSendBlockers,
  QuoteNotReadyError,
} from "./services/quotes";
import { sendQuoteWithEmail } from "./services/document-mail";
import { resolveCustomerEmail, resolveCustomerPhone } from "./resolve-missing-requirements";
import { requireCustomer } from "./services/data";
import {
  quoteChannelEnabled,
  quoteContactGapCopy,
  quoteHasSendDestination,
  quoteSendButtonEnabled,
} from "./quote-send-contact";
import { setMailTransportForTests } from "./mail";

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb(over));
}

function draftQuote(customerId: string) {
  const defaults = quoteDefaults();
  return createQuote({
    customerId,
    title: "Altan",
    lines: [labor()],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("offertkontakt: mjuka luckor, inte hard-block", () => {
  beforeEach(() => reset());

  it("quoteSendBlockers namnger fortfarande e-post; hard-listan hoppar över den", () => {
    reset({
      settings: { ...emptyTestDb().settings, address: "", postalCode: "", city: "" },
      customers: [testCustomer({ email: "", phone: "" })],
    });
    const quote = draftQuote("cust-1");
    const all = quoteSendBlockers(quote.id);
    assert.ok(all.some((b) => b.code === "buyer_email"));
    assert.ok(all.some((b) => b.code === "seller_address"));
    const hard = quoteHardSendBlockers(quote.id);
    assert.ok(!hard.some((b) => b.code === "buyer_email"));
    assert.ok(hard.some((b) => b.code === "seller_address"));
  });

  it("lucktexten nämner e-post och telefon - aldrig kan inte skicka", () => {
    const both = quoteContactGapCopy({ email: "", phone: "" });
    assert.equal(both.missingEmail, true);
    assert.equal(both.missingPhone, true);
    assert.match(both.banner ?? "", /e-post/);
    assert.match(both.banner ?? "", /telefon/);
    assert.doesNotMatch(both.banner ?? "", /kan inte skicka/i);

    const emailOnly = quoteContactGapCopy({ email: "", phone: "070-123 45 67" });
    assert.equal(emailOnly.missingEmail, true);
    assert.equal(emailOnly.missingPhone, false);
    assert.match(emailOnly.banner ?? "", /e-post/);
    assert.doesNotMatch(emailOnly.banner ?? "", /kan inte skicka/i);

    const phoneOnly = quoteContactGapCopy({ email: "a@b.se", phone: "" });
    assert.match(phoneOnly.banner ?? "", /telefon/);
    assert.doesNotMatch(phoneOnly.banner ?? "", /kan inte skicka/i);

    assert.equal(quoteContactGapCopy({ email: "a@b.se", phone: "070-123 45 67" }).banner, null);
  });

  it("Skicka är grå bara utan både e-post och telefon (och just inskrivet räknas)", () => {
    assert.equal(quoteSendButtonEnabled({ hardBlockers: 0, email: "", phone: "" }), false);
    assert.equal(quoteSendButtonEnabled({ hardBlockers: 0, email: "just@typed.se", phone: "" }), true);
    assert.equal(quoteSendButtonEnabled({ hardBlockers: 0, email: "", phone: "070-111 22 33" }), true);
    assert.equal(quoteSendButtonEnabled({ hardBlockers: 1, email: "just@typed.se", phone: "" }), false);
    assert.equal(quoteHasSendDestination({ email: "", phone: "" }), false);
    assert.equal(quoteHasSendDestination({ email: "  a@b.se  ", phone: "" }), true);
  });

  it("kanal slås på när destination finns eller just skrivits", () => {
    assert.equal(quoteChannelEnabled("email", { email: "", phone: "070-123 45 67" }), false);
    assert.equal(quoteChannelEnabled("sms", { email: "", phone: "070-123 45 67" }), true);
    assert.equal(quoteChannelEnabled("email", { email: "ny@exempel.se", phone: "" }), true);
    assert.equal(quoteChannelEnabled("sms", { email: "ny@exempel.se", phone: "" }), false);
    assert.equal(quoteChannelEnabled("sms", { email: "", phone: "0732104866" }), true);
  });

  it("QuoteDraftSend har inline e-post och telefon och säger inte kan inte skicka", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(join(here, "../components/quote-draft-send.tsx"), "utf8");
    assert.match(src, /offert-skicka-epost/);
    assert.match(src, /offert-skicka-telefon/);
    assert.match(src, /title="E-post"/);
    assert.match(src, /title="SMS"/);
    assert.match(src, /title="E-post och SMS"/);
    assert.doesNotMatch(src, /kan inte skicka/i);
    assert.doesNotMatch(src, /CustomerEmailPrompt/);
    assert.doesNotMatch(src, /\/kunder\//);
  });
});

describe("offertkontakt: persist på kunden", () => {
  beforeEach(() => reset({ customers: [] }));

  it("inline e-post och telefon skriver på samma kund - ingen ny kundpost", () => {
    const erik = createCustomer({ kind: "privat", name: "Erik" });
    assert.equal(erik.email, "");
    assert.equal(erik.phone, "");

    const mail = resolveCustomerEmail(erik.id, "erik@example.se");
    assert.equal(mail.ok, true);
    if (mail.ok) assert.equal(mail.email, "erik@example.se");

    const tel = resolveCustomerPhone(erik.id, "070-556 12 40");
    assert.equal(tel.ok, true);
    if (tel.ok) assert.match(tel.phone, /070/);

    const same = requireCustomer(erik.id);
    assert.equal(same.id, erik.id);
    assert.equal(same.email, "erik@example.se");
    assert.match(same.phone, /070/);
    assert.equal(db().customers.length, 1);
    assert.equal(db().customers.filter((c) => c.name === "Erik").length, 1);
  });
});

describe("offertkontakt: SMS-send utan e-post", () => {
  beforeEach(() => {
    delete process.env.RESEND_API_KEY;
    setMailTransportForTests(undefined);
    reset({ customers: [] });
  });

  afterEach(() => {
    setMailTransportForTests(undefined);
  });

  it("sendQuoteWithEmail med bara SMS markerar skickad när telefon finns", async () => {
    const sara = createCustomer({
      kind: "privat",
      name: "Sara Nilsson",
      address: "Blekingegatan 34",
      postalCode: "118 56",
      city: "Stockholm",
      phone: "070-111 22 33",
    });
    assert.equal(sara.email, "");
    const quote = draftQuote(sara.id);

    await assert.rejects(
      () => sendQuoteWithEmail(quote.id),
      (e: unknown) => {
        assert.ok(e instanceof QuoteNotReadyError);
        assert.ok(e.blockers.some((b) => b.code === "buyer_email"));
        return true;
      }
    );
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");

    const { outcome } = await sendQuoteWithEmail(quote.id, undefined, { channels: ["sms"] });
    assert.equal(outcome.ok, true);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
    assert.equal(requireCustomer(sara.id).email, "");
  });

  it("SMS utan telefon misslyckas utan att markera skickad", async () => {
    const bo = createCustomer({
      kind: "privat",
      name: "Bo Berg",
      address: "Gatan 1",
      postalCode: "111 22",
      city: "Stockholm",
    });
    const quote = draftQuote(bo.id);
    const { outcome } = await sendQuoteWithEmail(quote.id, undefined, { channels: ["sms"] });
    assert.equal(outcome.ok, false);
    assert.match(outcome.error ?? "", /telefon/i);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "utkast");
  });

  it("just inskriven telefon persisteras och låser upp SMS-send", async () => {
    const liv = createCustomer({
      kind: "privat",
      name: "Liv",
      address: "Gatan 2",
      postalCode: "111 22",
      city: "Stockholm",
    });
    const quote = draftQuote(liv.id);
    const saved = resolveCustomerPhone(liv.id, "073-987 65 43");
    assert.equal(saved.ok, true);
    updateCustomer(liv.id, { phone: requireCustomer(liv.id).phone });
    const { outcome } = await sendQuoteWithEmail(quote.id, undefined, { channels: ["sms"] });
    assert.equal(outcome.ok, true);
    assert.equal(db().quotes.find((q) => q.id === quote.id)?.status, "skickad");
    assert.match(requireCustomer(liv.id).phone, /073/);
  });
});
