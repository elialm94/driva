process.env.DRIVA_TEST = "1";

/**
 * Kundmejl efter hel kredit: ämne/brödtext, demo-isolering, mottagare
 * (kunden – inte snickaren) och att ett kastat utskick inte rullar tillbaka.
 */

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createInvoice, creditInvoice, issueInvoice } from "./services/invoices";
import { getInvoice } from "./services/data";
import { creditInvoiceEmail } from "./email/templates";
import { prepareCreditInvoiceMail } from "./email/service";
import {
  prepareCreditInvoiceNotice,
  sendCreditInvoiceNotice,
} from "./services/credit-invoice-notice";
import { invoiceHeading } from "./invoices/display";
import { setMailTransportForTests, type MailMessage } from "./mail";
import { createCustomer, updateCustomer } from "./services/customers";

const savedDemo = process.env.DRIVA_DEMO;

function issuedInvoice(customerId = "cust-1") {
  const inv = createInvoice({
    customerId,
    type: "faktura",
    lines: [labor({ unitPrice: 12_000 })],
    rot: null,
  });
  return issueInvoice(inv.id);
}

beforeEach(() => {
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.MAIL_FROM;
  delete process.env.RESEND_FROM;
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ email: "anna@test.se" })],
    })
  );
});

afterEach(() => {
  if (savedDemo === undefined) delete process.env.DRIVA_DEMO;
  else process.env.DRIVA_DEMO = savedDemo;
  setMailTransportForTests(undefined);
  delete process.env.RESEND_API_KEY;
  delete process.env.RESEND_FROM_EMAIL;
  delete process.env.MAIL_FROM;
  delete process.env.RESEND_FROM;
});

describe("creditInvoiceEmail: ämne och brödtext", () => {
  it("ämne är Kreditfaktura från företag – rubrik, brödtexten säger att originalet inte ska betalas", () => {
    const built = creditInvoiceEmail({
      businessName: "Test Snickeri AB",
      customerName: "Anna Andersson",
      title: "Kreditfaktura #101",
      originalNumber: 100,
      creditNumber: 101,
      url: "http://localhost:3123/faktura/token-kredit",
      footer: "Test Snickeri AB",
    });
    assert.equal(built.subject, "Kreditfaktura från Test Snickeri AB – Kreditfaktura #101");
    assert.match(built.text, /Faktura #100 är krediterad i sin helhet med kreditfaktura #101/);
    assert.match(built.text, /Du ska inte betala faktura #100/);
    assert.match(built.text, /Visa kreditfakturan/);
    assert.match(built.text, /\/faktura\/token-kredit/);
    assert.match(built.html, /kreditfaktura #101/);
    assert.match(built.html, /\/faktura\/token-kredit/);
  });

  it("utelämnar länken när publik kreditfaktura saknas", () => {
    const built = creditInvoiceEmail({
      businessName: "Test Snickeri AB",
      customerName: "Anna Andersson",
      title: "Kreditfaktura #101",
      originalNumber: 100,
      creditNumber: 101,
      footer: "Test Snickeri AB",
    });
    assert.doesNotMatch(built.text, /Visa kreditfakturan/);
    assert.doesNotMatch(built.html, /faktura\//);
  });
});

describe("prepareCreditInvoiceNotice", () => {
  it("riktigt företag: mejl till kunden med dokumentets rubrik och publik länk", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    const notice = prepareCreditInvoiceNotice(credit);
    assert.ok(notice, "ett mejl förbereds");
    assert.equal(notice.message.to, "anna@test.se");
    assert.notEqual(notice.message.to, db().settings.email);
    assert.equal(
      notice.message.subject,
      `Kreditfaktura från Test Snickeri AB – ${invoiceHeading(credit)}`
    );
    assert.match(notice.message.text, new RegExp(`Faktura #${original.number} är krediterad`));
    assert.match(notice.message.text, new RegExp(`kreditfaktura #${credit.number}`));
    assert.match(notice.message.text, new RegExp(`Du ska inte betala faktura #${original.number}`));
    assert.match(notice.message.text, new RegExp(`/faktura/${credit.token}`));
    assert.equal(notice.meta.kind, "invoice_credit");
    assert.equal(notice.meta.documentId, credit.id);
  });

  it("demoföretaget (is_demo): krediteringen fungerar men inget mejl förbereds", () => {
    process.env.DRIVA_DEMO = "0";
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ email: "anna@test.se" })],
        meta: { seededAt: new Date().toISOString(), demo: true },
      })
    );
    const sent: MailMessage[] = [];
    setMailTransportForTests(async (m) => {
      sent.push(m);
    });
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    assert.equal(getInvoice(original.id)!.status, "krediterad");
    assert.equal(prepareCreditInvoiceNotice(credit), null, "demo: ingen Resend");
    assert.equal(sent.length, 0);
  });

  it("demoläge (miljö): inget mejl förbereds", () => {
    process.env.DRIVA_DEMO = "1";
    setMailTransportForTests(async () => undefined);
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    assert.equal(getInvoice(original.id)!.status, "krediterad");
    assert.equal(prepareCreditInvoiceNotice(credit), null);
  });

  it("utan e-posttjänst: krediteringen blockeras inte", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(undefined);
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    assert.equal(getInvoice(original.id)!.status, "krediterad");
    assert.equal(prepareCreditInvoiceNotice(credit), null);
  });

  it("saknad kundadress: inget mejl till snickaren", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "should-not-send" }));
    const sara = createCustomer({
      kind: "privat",
      name: "Sara Nilsson",
      address: "Blekingegatan 34",
      postalCode: "118 56",
      city: "Stockholm",
    });
    const original = issuedInvoice(sara.id);
    original.issuedSnapshot = original.issuedSnapshot
      ? { ...original.issuedSnapshot, buyer: { ...original.issuedSnapshot.buyer, email: "" } }
      : original.issuedSnapshot;
    const credit = creditInvoice(original.id);
    if (credit.issuedSnapshot) {
      credit.issuedSnapshot = { ...credit.issuedSnapshot, buyer: { ...credit.issuedSnapshot.buyer, email: "" } };
    }
    const notice = prepareCreditInvoiceNotice(credit);
    assert.equal(notice, null);
    assert.equal(db().settings.email, "info@test.se", "företagets inkorg finns men används inte");
    assert.equal(getInvoice(original.id)!.status, "krediterad");
  });

  it("mottagaren är kundens e-post, inte företagets", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    const notice = prepareCreditInvoiceNotice(credit);
    assert.ok(notice);
    assert.equal(notice.message.to, "anna@test.se");
    assert.notEqual(notice.message.to, "info@test.se");
    assert.doesNotMatch(notice.message.text, /info@test\.se/);
  });

  it("delkredit ger inget kundmejl", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    const original = issuedInvoice();
    const credit = creditInvoice(original.id, "anvandare", { amountInclVat: 2_500 });
    assert.notEqual(getInvoice(original.id)!.status, "krediterad");
    assert.equal(prepareCreditInvoiceNotice(credit), null);
  });
});

describe("kreditering och utskick är isolerade", () => {
  it("krediteringen står kvar om utskicket kastar", async () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => {
      throw new Error("Resend 500");
    });
    const original = issuedInvoice();
    const credit = creditInvoice(original.id);
    const notice = prepareCreditInvoiceNotice(credit);
    assert.ok(notice);
    await sendCreditInvoiceNotice(notice);
    assert.equal(getInvoice(original.id)!.status, "krediterad");
    assert.equal(getInvoice(credit.id)?.type, "kredit");
    assert.equal(getInvoice(credit.id)?.number, credit.number);
  });

  it("prepareCreditInvoiceMail pekar på kundens adress och kreditdokumentets rubrik", () => {
    process.env.DRIVA_DEMO = "0";
    const prepared = prepareCreditInvoiceMail({
      to: "anna@test.se",
      creditId: "cred-1",
      company: "Test Snickeri AB",
      customerName: "Anna Andersson",
      title: "Kreditfaktura #101",
      originalNumber: 100,
      creditNumber: 101,
      token: "abc123",
    });
    assert.equal(prepared.message.to, "anna@test.se");
    assert.equal(prepared.message.subject, "Kreditfaktura från Test Snickeri AB – Kreditfaktura #101");
    assert.match(prepared.message.text, /\/faktura\/abc123/);
    assert.equal(prepared.meta.kind, "invoice_credit");
  });
});

describe("resolveCustomerEmail-kedjan", () => {
  it("efter komplettering av kundens e-post går notisen till den adressen", () => {
    process.env.DRIVA_DEMO = "0";
    setMailTransportForTests(async () => ({ messageId: "resend-1" }));
    const erik = createCustomer({
      kind: "privat",
      name: "Erik",
      address: "Gatan 1",
      postalCode: "111 22",
      city: "Stockholm",
    });
    const original = issuedInvoice(erik.id);
    updateCustomer(erik.id, { email: "erik@example.se" });
    const credit = creditInvoice(original.id);
    const notice = prepareCreditInvoiceNotice(credit);
    assert.ok(notice);
    assert.equal(notice.message.to, "erik@example.se");
    assert.notEqual(notice.message.to, db().settings.email);
  });
});
