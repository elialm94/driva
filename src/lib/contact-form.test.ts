process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { submitContactForm, websiteJobQuoteCtaHref } from "./services/website";
import { getBusinessProfile, getWebsiteNotificationEmail, updateCompanySettings } from "./services/settings";
import { resolveWebsiteFormRecipient } from "./website-form-recipient";
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
    websiteNotificationEmail: s.websiteNotificationEmail,
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

describe("webbformulär → uppdrag", () => {
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

  it("skapar kund och uppdrag och mejlar företagaren", async () => {
    const result = await submitContactForm({ ...visitor, idempotencyKey: "k1" });
    assert.equal("skipped" in result, false);
    if ("skipped" in result) return;
    assert.equal(result.created, true);
    assert.equal(result.mailed, true);

    const data = db();
    const customer = data.customers.find((c) => c.id === result.customerId);
    const job = data.jobs.find((j) => j.id === result.jobId);
    assert.ok(customer);
    assert.equal(customer.email, visitor.email);
    assert.equal(customer.name, visitor.name);
    assert.ok(job);
    assert.equal(job.customerId, customer.id);
    assert.equal(job.source, "web_form");
    assert.equal(job.originalMessage, visitor.message);
    assert.equal(job.description, visitor.message);
    assert.equal(job.notification?.status, "sent");
    assert.equal(data.inboxItems?.length ?? 0, 0);

    assert.equal(sent.length, 1);
    const expectedTo = resolveWebsiteFormRecipient(getBusinessProfile(), getBusinessProfile());
    assert.equal(sent[0].to, expectedTo);
    assert.equal(sent[0].to, getWebsiteNotificationEmail());
    assert.equal(sent[0].replyTo, visitor.email);
    assert.match(sent[0].subject, /Nytt uppdrag från webbformuläret/);
    const cta = websiteJobQuoteCtaHref(customer.id, job.id);
    assert.equal(cta, `/ekonomi/offerter/ny?kund=${customer.id}&job=${job.id}`);
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
    const jobs = db().jobs.filter((j) => j.customerId === withEmail[0].id && j.source === "web_form");
    assert.equal(jobs.length, 2);
  });

  it("behåller uppdraget om mejlet misslyckas", async () => {
    setMailTransportForTests(async () => {
      throw new Error("smtp nere");
    });
    const result = await submitContactForm({ ...visitor, idempotencyKey: "fail-1" });
    assert.equal("skipped" in result, false);
    if ("skipped" in result) return;
    assert.equal(result.created, true);
    assert.equal(result.mailed, false);
    const job = db().jobs.find((j) => j.id === result.jobId);
    assert.ok(job);
    assert.equal(job.notification?.status, "failed");
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 1);
  });

  it("retry skickar mejl utan ny kund eller uppdrag", async () => {
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
    assert.equal(second.jobId, first.jobId);
    assert.equal(second.customerId, first.customerId);
    assert.equal(second.mailed, true);
    assert.equal(sent.length, 1);

    const third = await submitContactForm({ ...visitor, idempotencyKey: "retry-1" });
    assert.equal("skipped" in third, false);
    if ("skipped" in third) return;
    assert.equal(third.created, false);
    assert.equal(sent.length, 1);

    assert.equal(db().jobs.filter((j) => j.customerId === first.customerId).length, 1);
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 1);
  });

  it("använder aviseringsadressen från inställningarna, inte den publika e-posten", async () => {
    const publicEmail = getBusinessProfile().email;
    updateCompanySettings(settingsInput({ websiteNotificationEmail: "chef@test.se" }));
    assert.equal(getBusinessProfile().email, publicEmail);
    assert.equal(getWebsiteNotificationEmail(), "chef@test.se");
    assert.equal(
      resolveWebsiteFormRecipient(getBusinessProfile(), getBusinessProfile()),
      "chef@test.se",
    );

    await submitContactForm({ ...visitor, idempotencyKey: "notify-1" });
    assert.equal(sent[0].to, "chef@test.se");
    assert.notEqual(sent[0].to, publicEmail);
  });

  it("mejlar företagets e-post när ingen egen mottagare är satt", async () => {
    const company = getBusinessProfile();
    assert.equal(company.websiteNotificationEmail, undefined);
    const to = resolveWebsiteFormRecipient(company, company);
    assert.equal(to, company.email);

    await submitContactForm({ ...visitor, idempotencyKey: "default-mail-1" });
    assert.equal(sent[0].to, to);
  });

  it("följer ny företagsmail när override saknas", async () => {
    updateCompanySettings(settingsInput({ email: "ny@test.se", websiteNotificationEmail: undefined }));
    assert.equal(getBusinessProfile().websiteNotificationEmail, undefined);
    assert.equal(getWebsiteNotificationEmail(), "ny@test.se");

    await submitContactForm({ ...visitor, idempotencyKey: "follow-company-1" });
    assert.equal(sent[0].to, "ny@test.se");
  });

  it("honeypot skapar varken kund, uppdrag eller mejl", async () => {
    const result = await submitContactForm({
      ...visitor,
      website: "https://spam.example",
      idempotencyKey: "bot",
    });
    assert.deepEqual(result, { skipped: true });
    assert.equal(db().customers.filter((c) => c.email === visitor.email).length, 0);
    assert.equal(db().jobs.length, 0);
    assert.equal(sent.length, 0);
  });
});
