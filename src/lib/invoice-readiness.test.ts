process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { createJob } from "./services/jobs";
import { addJobMaterial, uninvoicedActuals } from "./services/job-work";
import { invoiceReadiness } from "./services/invoice-readiness";
import {
  confirmDocumentLines,
  setLineCustomerPrice,
  upsertDocumentLinesFromParsed,
} from "./services/document-lines";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1" })],
    })
  );
}

describe("faktura redo (materialkedjan)", () => {
  beforeEach(() => reset());

  it("samlar manuellt material och bekräftade kvittorader utan extra dubbletter", () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    addJobMaterial(job.id, { description: "Skruv", qty: 2, unit: "st", unitPrice: 12, source: "manual" });
    const lines = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-ready",
      parsed: { amount: 100, lines: [{ name: "Skruv", qty: 2, unitPrice: 50, lineAmount: 100 }] },
      startedFromJobId: job.id,
    });
    setLineCustomerPrice(lines[0].id, 80);
    confirmDocumentLines(lines.map((l) => l.id));

    const view = invoiceReadiness(job.id);
    assert.equal(view.ready, true);
    assert.equal(view.blockers.length, 0);
    assert.equal(uninvoicedActuals(job.id).filter((e) => e.type === "material").length, 2);
    assert.equal(view.unfinishedLineCount, 0);
  });

  it("blockerar saknat kundpris så det inte blir 0 kr", () => {
    const job = createJob({ customerId: "cust-1", title: "Badrum" });
    upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-pris",
      parsed: { amount: 80, lines: [{ name: "Silikon", qty: 1, unitPrice: 80, lineAmount: 80 }] },
      startedFromJobId: job.id,
    });
    const missing = invoiceReadiness(job.id);
    assert.equal(missing.ready, false);
    assert.ok(missing.blockers.some((row) => row.kind === "missing_customer_price"));
    assert.equal(uninvoicedActuals(job.id).length, 0);
  });

  it("osäker rad blockerar, men bekräftat material kan faktureras och resten ligger kvar", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const lines = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-osaker",
      parsed: {
        amount: 180,
        lines: [
          { name: "Silikon", qty: 1, unitPrice: 80, lineAmount: 80 },
          { name: "Oläslig", unreadable: true },
        ],
      },
      startedFromJobId: job.id,
    });
    const before = invoiceReadiness(job.id);
    assert.ok(before.blockers.some((row) => row.kind === "uncertain_line"));
    assert.ok(before.unfinishedLineCount >= 1);

    setLineCustomerPrice(lines[0].id, 110);
    confirmDocumentLines([lines[0].id]);
    const after = invoiceReadiness(job.id);
    assert.ok(after.canInvoiceWithoutUnfinished);
    assert.equal(uninvoicedActuals(job.id).some((e) => e.description === "Silikon"), true);
    assert.ok(after.unfinishedLineCount >= 1);
  });
});
