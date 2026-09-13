process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, testCustomer } from "./invoices/test-db";
import { createJob, ensureJobPurchaseRef } from "./services/jobs";
import {
  confirmDocumentLines,
  setLineAllocations,
  setLineCustomerPrice,
  setLineDisposition,
  upsertDocumentLinesFromParsed,
  linesForSource,
} from "./services/document-lines";
import { addJobMaterialFromExpense, actualEntries, uninvoicedActuals } from "./services/job-work";
import { createInvoiceFromJobActuals } from "./services/invoices";
import { createExpenseFromKnownReceipt } from "./services/expenses";
import { ingestUploadedDocument } from "./services/inbox";

function reset() {
  replaceDb(
    emptyTestDb({
      settings: {
        ...emptyTestDb().settings,
        inboundMailSlug: "testbolag",
      },
      customers: [testCustomer({ id: "cust-1" })],
    })
  );
}

function sevenLines() {
  return [
    { name: "Skruv", qty: 1, unitPrice: 89, lineAmount: 89 },
    { name: "Regel", qty: 8, unitPrice: 42, lineAmount: 336 },
    { name: "Skiva", qty: 2, unitPrice: 249, lineAmount: 498 },
    { name: "Beslag", qty: 10, unitPrice: 12, lineAmount: 120 },
    { name: "Trallskruv", qty: 1, unitPrice: 79, lineAmount: 79 },
    { name: "Fog", qty: 1, unitPrice: 65, lineAmount: 65 },
    { name: "Pensel", qty: 1, unitPrice: 61, lineAmount: 61 },
  ];
}

describe("dokumentrader till uppdrag", () => {
  beforeEach(() => reset());

  it("2. en rad ska inte faktureras kunden", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const lines = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-1",
      parsed: { amount: 1248, lines: sevenLines() },
      startedFromJobId: job.id,
    });
    setLineDisposition(lines[0].id, "company");
    setLineCustomerPrice(lines[1].id, 50);
    for (const line of lines.slice(1)) setLineCustomerPrice(line.id, 50);
    const result = confirmDocumentLines(lines.map((l) => l.id));
    assert.equal(result.confirmed.length, 7);
    const material = actualEntries(job.id).filter((e) => e.type === "material");
    assert.equal(material.length, 6);
    assert.equal(db().documentLines?.find((l) => l.id === lines[0].id)?.disposition, "company");
  });

  it("3. ett kvitto delas mellan två uppdrag", () => {
    const a = createJob({ customerId: "cust-1", title: "Altan" });
    const b = createJob({ customerId: "cust-1", title: "Kök" });
    const [line] = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-2",
      parsed: { amount: 200, lines: [{ name: "Skruv", qty: 2, unitPrice: 100, lineAmount: 200 }] },
    });
    setLineAllocations(line.id, [
      { jobId: a.id, qty: 1 },
      { jobId: b.id, qty: 1 },
    ]);
    setLineCustomerPrice(line.id, 150);
    confirmDocumentLines([line.id]);
    assert.equal(actualEntries(a.id).filter((e) => e.type === "material").length, 1);
    assert.equal(actualEntries(b.id).filter((e) => e.type === "material").length, 1);
  });

  it("9. kvitto skapar ett bokföringsunderlag men flera fakturerbara materialrader", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const { expense } = createExpenseFromKnownReceipt({
      supplier: "Byggmax",
      amount: 1248,
      vatAmount: 250,
      date: "2026-09-01",
      description: "Byggmax",
    });
    const lines = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-3",
      expenseId: expense.id,
      parsed: { amount: 1248, lines: sevenLines() },
      startedFromJobId: job.id,
    });
    for (const line of lines) setLineCustomerPrice(line.id, 40);
    confirmDocumentLines(lines.map((l) => l.id));
    assert.equal(addJobMaterialFromExpense({ ...expense, jobId: job.id }), null);
    assert.equal(actualEntries(job.id).filter((e) => e.type === "material").length, 7);
    assert.equal(db().expenses.filter((e) => e.id === expense.id).length, 1);
  });

  it("11. samma dokumentrad skapar inte samma material två gånger", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const [line] = upsertDocumentLinesFromParsed({
      source: "order_confirmation",
      sourceDocumentId: "ob-1",
      parsed: { amount: 100, lines: [{ name: "Kabel", qty: 1, unitPrice: 100, lineAmount: 100 }] },
      startedFromJobId: job.id,
    });
    setLineCustomerPrice(line.id, 130);
    confirmDocumentLines([line.id]);
    confirmDocumentLines([line.id]);
    assert.equal(actualEntries(job.id).filter((e) => e.type === "material").length, 1);
  });

  it("13. saknat kundpris blir aldrig 0 kr på fakturan", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const [line] = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-4",
      parsed: { amount: 80, lines: [{ name: "Skruv", qty: 1, unitPrice: 80, lineAmount: 80 }] },
      startedFromJobId: job.id,
    });
    const skipped = confirmDocumentLines([line.id]);
    assert.equal(skipped.skipped.length, 1);
    assert.equal(actualEntries(job.id).length, 0);
    setLineCustomerPrice(line.id, 110);
    confirmDocumentLines([line.id]);
    const invoice = createInvoiceFromJobActuals(job.id, "anvandare");
    assert.ok(invoice.lines.every((l) => l.unitPrice > 0));
  });

  it("21. material som inte tas med på första fakturan finns kvar", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const lines = upsertDocumentLinesFromParsed({
      source: "receipt",
      sourceDocumentId: "kv-5",
      parsed: {
        amount: 200,
        lines: [
          { name: "Klar", qty: 1, unitPrice: 100, lineAmount: 100 },
          { name: "Senare", qty: 1, unitPrice: 100, lineAmount: 100 },
        ],
      },
      startedFromJobId: job.id,
    });
    setLineCustomerPrice(lines[0].id, 140);
    confirmDocumentLines([lines[0].id]);
    const invoice = createInvoiceFromJobActuals(job.id, "anvandare", [uninvoicedActuals(job.id)[0].id]);
    assert.equal(invoice.lines.length, 1);
    assert.equal(linesForSource("receipt", "kv-5").find((l) => l.id === lines[1].id)?.status !== "confirmed", true);
    assert.equal(uninvoicedActuals(job.id).length, 0);
    const leftover = db().documentLines?.find((l) => l.id === lines[1].id);
    assert.ok(leftover);
    assert.notEqual(leftover.status, "rejected");
  });

  it("inköpsreferens tilldelas vid visning och är unik", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    assert.equal(job.purchaseRef, undefined);
    const ref = ensureJobPurchaseRef(job.id);
    assert.match(ref, /^FV-\d+$/);
    assert.equal(ensureJobPurchaseRef(job.id), ref);
  });

  it("uppladdning från uppdrag sätter suggestedJobId", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    const result = ingestUploadedDocument({
      filename: "kvitto.jpg",
      contentType: "image/jpeg",
      startedFromJobId: job.id,
      parsed: { documentType: "kvitto", amount: 100, supplier: "Byggmax", lines: [{ name: "Skruv", qty: 1, lineAmount: 100 }] },
    });
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.equal(result.item.suggestedJobId, job.id);
      assert.equal(result.item.jobMatchMethod, "started_from_job");
    }
  });
});
