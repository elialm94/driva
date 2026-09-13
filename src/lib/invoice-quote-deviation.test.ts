process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { addJobMaterial } from "./services/job-work";
import { approveJobChange, createJobChange, sendJobChange } from "./services/job-changes";
import { createCloseoutInvoiceDraft, setBillingDeferral, closeoutBasis } from "./services/closeout";
import { invoiceQuoteDeviation } from "./services/invoice-quote-deviation";
import { invoiceTotals } from "./services/data";
import { issueInvoice } from "./services/invoices";
import type { PaymentPlanPart } from "./types";

const PLAN: PaymentPlanPart[] = [
  { label: "Vid arbetets start", percent: 30, kind: "forskott" },
  { label: "När arbetet är klart", percent: 70, kind: "slutbetalning" },
];

function setup() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Johan Lindberg" })] }));
  const quote = createQuote({
    customerId: "cust-1",
    title: "Altantrappa",
    lines: [labor({ id: "q1", qty: 20, unitPrice: 600 })],
    rot: null,
    paymentPlan: PLAN,
    paymentTermsDays: 14,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-09-01T10:00:00.000Z";
  const job = createJobFromQuote(quote);
  const change = sendJobChange(
    createJobChange(job.id, {
      title: "Extra handledare",
      description: "",
      lines: [labor({ id: "c1", description: "Handledare, montering", qty: 4, unitPrice: 600 })],
    }).id
  );
  approveJobChange({ token: change.token, name: "Johan Lindberg" });
  return { quote, job, change };
}

describe("Avvikelse mot offert: godkända ändringar är avtalade", () => {
  beforeEach(() => setup());

  it("delfaktura med förskott + godkänd ändring avviker inte från vad kunden godkänt", () => {
    const { job } = setup();
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "delfaktura" });
    // 30 % av 15 000 = 4 500 + ändringen 4 × 600 × 1,25 = 3 000
    assert.equal(invoiceTotals(draft).toPay, 7500);
    const deviation = invoiceQuoteDeviation(draft);
    assert.equal(deviation, null, "kunden har godkänt både offerten och ändringen - ingen varning");
  });

  it("slutfaktura efter en skickad delfaktura med ändring: resten räknas utan ändringens belopp", () => {
    const { job } = setup();
    const part = createCloseoutInvoiceDraft(job.id, { mode: "delfaktura" });
    issueInvoice(part.id);
    const final = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(invoiceTotals(final).toPay, 10500, "70 % av 15 000");
    assert.equal(invoiceQuoteDeviation(final), null);
  });

  it("slutfaktura med rest + godkänd ändring avviker inte, men ett ogodkänt tillägg gör det", () => {
    const { job } = setup();
    const clean = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(invoiceQuoteDeviation(clean), null);

    // Nytt uppdrag med ett tillägg utöver offerten som kunden inte godkänt
    const { job: job2 } = setup();
    addJobMaterial(job2.id, { description: "Ekplank 28 mm", qty: 1, unitPrice: 3200 }).isExtra = true;
    const changeItem = closeoutBasis(job2.id).items.find((i) => i.sourceType === "change_line");
    assert.ok(changeItem);
    setBillingDeferral(job2.id, { sourceType: "change_line", sourceId: changeItem!.sourceId }, "hantera_senare");
    const withExtra = createCloseoutInvoiceDraft(job2.id, { mode: "slutfaktura" });
    const deviation = invoiceQuoteDeviation(withExtra);
    assert.ok(deviation, "tillägget utan godkännande ska flaggas");
    assert.equal(deviation!.delta, 4000);
    assert.deepEqual(
      deviation!.addedLines.map((l) => l.description),
      ["Ekplank 28 mm"]
    );
  });
});
