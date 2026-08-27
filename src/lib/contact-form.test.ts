process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { setMailTransportForTests, type MailMessage } from "./mail";
import {
  inquiryQuoteCtaHref,
  submitContactForm,
} from "./services/website";
import { getBusinessProfile, getInquiryNotificationEmail, updateCompanySettings } from "./services/settings";
import type { CompanySettingsInput } from "./services/settings";

const visitor = {
  name: "Karin Testsson",
  email: "karin-test@example.se",
  phone: "070-111 22 33",
  message: "Hej! Vi vill ha hjälp med en ny altan på ca 30 kvm.",
};

function settingsInput(over: Partial<CompanySettingsInput> = {}): CompanySettingsInput {
  const s = getBusinessProfile();
  return {
    name: s.name,
    orgNumber: s.orgNumber,
    vatNumber: s.vatNumber,
    email: s.email,
    inquiryNotificationEmail: s.inquiryNotificationEmail,
    phone: s.phone,
    websiteUrl: s.websiteUrl,
    address: s.address,
    postalCode: s.postalCode,
    city: s.city,
    sate: s.sate,
    country: s.country,
    bankgiro: s.bankgiro,
    plusgiro: s.plusgiro,
    bankAccount: s.bankAccount,
    iban: s.iban,
    bic: s.bic,
    logoInitials: s.logoInitials,
    logoDataUrl: s.logoDataUrl,
    paymentTermsDays: s.paymentTermsDays,
    lateInterestRate: s.lateInterestRate,
    quoteValidityDays: s.quoteValidityDays ?? 30,
    defaultVatRate: s.defaultVatRate ?? 25,
    ...over,
  };
}

describe("sajtförfrågan", () => {
  const sent: MailMessage[] = [];

  beforeEach(() => {
    sent.length = 0;
    setMailTransportForTests(async (msg) => {
      sent.push(msg);
    });
    replaceDb(
      emptyTestDb({
        customers: [testCustomer()],
      })
    );
  });

  afterEach(() => {
    setMailTransportForTests(undefined);
  });

  it("skapar kund och förfrågan och mejlar företagaren", async () => {
    const result = await submitContactForm({ ...visitor, idempotencyKey: "k1" });
    assert.equal("skipped" in result, false);
    if ("skipped" in result) return;
    assert.equal(result.created, true);
    assert.equal(result.mailed, true);

    const data = db();
    const customer = data.customers.find((c) => c.id === result.customerId);
    const request = data.requests.find((r) => r.id === result.requestId);
    assert.ok(customer);
    assert.equal(customer.email, visitor.email);
    assert.equal(customer.name, visitor.name);
    assert.ok(request);
    assert.equal(request.customerId, customer.id);
    assert.equal(request.source, "hemsida");
    assert.equal(request.status, "ny");
    assert.equal(request.notification?.status, "sent");

    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, getInquiryNotificationEmail());
    assert.equal(sent[0].replyTo, visitor.email);
    assert.match(sent[0].subject, /Karin Testsson/);
    const cta = inquiryQuoteCtaHref(customer.id, request.id);
    assert.equal(cta, `/ekonomi/offerter/ny?kund=${customer.id}&forfragan=${request.id}`);
    assert.ok(sent[0].text.includes(cta));
    assert.ok(sent[0].html.includes("Skapa offert"));
  });

  it("återanvänder kund vid samma e-post", async () => {
    await submitContactForm({ ...visitor, idempotencyKey: "a", message: "Första altanen." });
    await submitContactForm({
      ...visitor,
      idempotencyKey: "b",
      message: "Andra frågan om bänkskiva i kök.",
    });
    const withEmail = db().customers.filter((c) => c.email.toLowerCase() === visitor.email);
    assert.equal(withEmail.length, 1);
    const inquiries = db().requests.filter((r) => r.customerId === withEmail[0].id);
    assert.equal(inquiries.length, 2);
  });

  it("behåller förfrågan om mejlet misslyckas", async () => {
    setMailTransportForTests(async () => {
      throw new Error("smtp nere");
    });
    const result = await submitContactForm({ ...visitor, idempotencyKey: "fail-1" });
    assert.equal("skipped" in result, false);
    if ("skipped" in result) return;
    assert.equal(result.created, true);
    assert.equal(result.mailed, false);
    const request = db().requests.find((r) => r.id === result.requestId);
    assert.ok(request);
    assert.equal(request.notification?.status, "failed");
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 1);
  });

  it("retry skickar mejl utan ny kund eller förfrågan", async () => {
    setMailTransportForTests(async () => {
      throw new Error("smtp nere");
    });
    const first = await submitContactForm({ ...visitor, idempotencyKey: "retry-1" });
    assert.equal("skipped" in first, false);
    if ("skipped" in first) return;

    setMailTransportForTests(async (msg) => {
      sent.push(msg);
    });
    const second = await submitContactForm({ ...visitor, idempotencyKey: "retry-1" });
    assert.equal("skipped" in second, false);
    if ("skipped" in second) return;
    assert.equal(second.created, false);
    assert.equal(second.requestId, first.requestId);
    assert.equal(second.customerId, first.customerId);
    assert.equal(second.mailed, true);
    assert.equal(sent.length, 1);

    const third = await submitContactForm({ ...visitor, idempotencyKey: "retry-1" });
    assert.equal("skipped" in third, false);
    if ("skipped" in third) return;
    assert.equal(third.created, false);
    assert.equal(sent.length, 1);

    assert.equal(db().requests.filter((r) => r.customerId === first.customerId).length, 1);
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 1);
  });

  it("använder aviseringsadressen från inställningarna, inte den publika e-posten", async () => {
    const publicEmail = getBusinessProfile().email;
    updateCompanySettings(settingsInput({ inquiryNotificationEmail: "chef@test.se" }));
    assert.equal(getBusinessProfile().email, publicEmail);
    assert.equal(getInquiryNotificationEmail(), "chef@test.se");

    await submitContactForm({ ...visitor, idempotencyKey: "notify-1" });
    assert.equal(sent[0].to, "chef@test.se");
    assert.notEqual(sent[0].to, publicEmail);
  });

  it("honeypot skapar varken kund, förfrågan eller mejl", async () => {
    const result = await submitContactForm({
      ...visitor,
      website: "https://spam.example",
      idempotencyKey: "bot",
    });
    assert.deepEqual(result, { skipped: true });
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 0);
    assert.equal(db().requests.length, 0);
    assert.equal(sent.length, 0);
  });
});
