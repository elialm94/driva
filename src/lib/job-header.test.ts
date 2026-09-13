process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createJob, createJobFromQuote, jobRemovalPolicy } from "./services/jobs";
import { createInvoice, issueInvoice } from "./services/invoices";
import { jobAdminState } from "./services/job-admin";
import { jobMoney } from "./services/job-economy";
import { getJob } from "./services/data";
import { registerJobTime } from "./services/job-work";

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1" })] }));
}

function draftQuote(over: { jobId?: string; qty?: number; unitPrice?: number } = {}) {
  const defaults = quoteDefaults();
  return createQuote({
    customerId: "cust-1",
    jobId: over.jobId,
    title: "Köksrenovering",
    lines: [labor({ qty: over.qty ?? 10, unit: "tim", unitPrice: over.unitPrice ?? 580 })],
    rot: null,
    paymentPlan: [],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("uppdragshuvud och Ekonomi-tal", () => {
  beforeEach(() => reset());

  it("offertutkast + fakturautkast sätter inte Väntar på betalning och inte Avtalat", () => {
    const job = createJob({ customerId: "cust-1", title: "Köksrenovering" });
    const quote = draftQuote({ jobId: job.id });
    createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      type: "faktura",
      lines: [labor({ qty: 1, unitPrice: 250 })],
      rot: null,
    });
    const admin = jobAdminState(getJob(job.id)!);
    const money = jobMoney(job.id);
    assert.equal(quote.status, "utkast");
    assert.equal(money.quoteAmount, 0);
    assert.ok(money.quoteDocumentAmount > 0);
    assert.equal(admin.quoteAction, "fortsatt_offert");
    assert.match(admin.nextStep ?? "", /Offerten är ett utkast/);
    assert.equal((admin.nextStep ?? "").includes("Väntar på betalning"), false);
    assert.ok(!("waitingLabel" in admin));
  });

  it("registrerad tid syns inte som Avtalat eller Kvar utan godkänd offert", () => {
    const job = createJob({ customerId: "cust-1", title: "Köksrenovering" });
    registerJobTime(job.id, { hours: 1, unitPrice: 250 });
    const money = jobMoney(job.id);
    assert.equal(money.registered, 313);
    assert.equal(money.quoteAmount, 0);
    assert.equal(money.remaining, 0);
  });

  it("utfärdad faktura stänger Ta bort med en rad", () => {
    const job = createJob({ customerId: "cust-1", title: "Köksrenovering" });
    const inv = createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      type: "faktura",
      lines: [labor({ qty: 1, unitPrice: 1000 })],
      rot: null,
    });
    issueInvoice(inv.id);
    const policy = jobRemovalPolicy(job.id);
    assert.equal(policy.kind, "archive");
    assert.equal(policy.disabledReason, "Uppdraget har en utfärdad faktura.");
  });

  it("godkänd offert stänger Ta bort även utan faktura", () => {
    const quote = draftQuote();
    quote.status = "godkand";
    const job = createJobFromQuote(quote);
    const policy = jobRemovalPolicy(job.id);
    assert.equal(policy.kind, "archive");
    assert.equal(policy.disabledReason, "Uppdraget har en godkänd offert.");
  });
});
