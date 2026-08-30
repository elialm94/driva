process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { createQuote, discardQuote, quoteDefaults, restoreQuote, sendQuote } from "./services/quotes";
import { createInvoice, createInvoiceForJob, discardInvoice, restoreInvoice } from "./services/invoices";
import { createJob } from "./services/jobs";
import { registerJobTime } from "./services/job-work";
import { listInvoicesForTable, listQuotesForTable } from "./services/economy-list";
import { getInvoice, getQuote } from "./services/data";

function draftQuote(title = "Utkast") {
  const defaults = quoteDefaults();
  return createQuote({
    customerId: "cust-1",
    title,
    intro: "",
    lines: [labor()],
    rot: null,
    paymentPlan: [],
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
}

describe("kasta offertutkast", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb());
  });

  it("kastar utkastet och tar bort versioner", () => {
    const quote = draftQuote();
    assert.equal(quote.status, "utkast");
    const versionId = quote.currentVersionId;
    const snapshot = discardQuote(quote.id);
    assert.equal(getQuote(quote.id), undefined);
    assert.equal(db().quoteVersions.some((v) => v.id === versionId), false);
    assert.equal(snapshot.quote.id, quote.id);
    assert.equal(listQuotesForTable().total, 0);
  });

  it("återställer utkastet med Ångra", () => {
    const quote = draftQuote("Köksrenovering");
    const snapshot = discardQuote(quote.id);
    restoreQuote(snapshot);
    const restored = getQuote(quote.id);
    assert.ok(restored);
    assert.equal(restored.status, "utkast");
    assert.equal(restored.currentVersionId, quote.currentVersionId);
    assert.ok(db().quoteVersions.some((v) => v.id === quote.currentVersionId));
    assert.equal(listQuotesForTable().rows[0].statusKey, "utkast");
  });

  it("kopplar loss och återställer uppdragets quoteId", () => {
    const job = createJob({ customerId: "cust-1", title: "Kök" });
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      jobId: job.id,
      title: "Kök",
      intro: "",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.equal(db().jobs.find((j) => j.id === job.id)?.quoteId, quote.id);
    const snapshot = discardQuote(quote.id);
    assert.equal(db().jobs.find((j) => j.id === job.id)?.quoteId, undefined);
    restoreQuote(snapshot);
    assert.equal(db().jobs.find((j) => j.id === job.id)?.quoteId, quote.id);
  });

  it("kan inte kasta en skickad offert", () => {
    const quote = draftQuote();
    sendQuote(quote.id);
    assert.equal(getQuote(quote.id)?.status, "skickad");
    assert.throws(() => discardQuote(quote.id), /offertutkast/i);
    assert.ok(getQuote(quote.id));
  });
});

describe("kasta fakturautkast", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb());
  });

  it("kastar utkastet så raden försvinner ur registret", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const snapshot = discardInvoice(invoice.id);
    assert.equal(getInvoice(invoice.id), undefined);
    assert.equal(snapshot.invoice.id, invoice.id);
    assert.equal(listInvoicesForTable().total, 0);
  });

  it("återställer utkastet och jobbarbetets koppling", () => {
    const job = createJob({ customerId: "cust-1", title: "Utkast" });
    const entry = registerJobTime(job.id, { hours: 1, unitPrice: 400 });
    const invoice = createInvoiceForJob(job.id, "actuals");
    assert.equal(db().jobWorkEntries.find((e) => e.id === entry.id)?.invoiceId, invoice.id);
    const snapshot = discardInvoice(invoice.id);
    assert.equal(db().jobWorkEntries.find((e) => e.id === entry.id)?.invoiceId, undefined);
    restoreInvoice(snapshot);
    assert.ok(getInvoice(invoice.id));
    assert.equal(db().jobWorkEntries.find((e) => e.id === entry.id)?.invoiceId, invoice.id);
    assert.equal(listInvoicesForTable().rows[0].draft, true);
  });

  it("kan inte kasta en skickad faktura", () => {
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    invoice.status = "skickad";
    assert.throws(() => discardInvoice(invoice.id), /kreditera|utfärdade/i);
    assert.ok(getInvoice(invoice.id));
  });

  it("listan flaggar bara utkast som draft", () => {
    const draft = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    const sent = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor()],
      rot: null,
    });
    sent.status = "skickad";
    sent.number = 1042;
    const rows = listInvoicesForTable().rows;
    assert.equal(rows.find((r) => r.id === draft.id)?.draft, true);
    assert.equal(rows.find((r) => r.id === sent.id)?.draft, false);
  });
});
