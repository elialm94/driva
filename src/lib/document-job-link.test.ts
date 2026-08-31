process.env.DRIVA_TEST = "1";

/**
 * Koppling offert/faktura ↔ uppdrag: samma kund, auto-länk i kedjan,
 * losskoppling och tom lista.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJob, startJobFromQuote } from "./services/jobs";
import { createInvoice, createInvoiceForJob, createInvoiceFromQuote } from "./services/invoices";
import {
  createJobAndLinkDocument,
  documentLinkView,
  jobsForCustomerLink,
  linkDocumentToJob,
  unlinkDocumentFromJob,
} from "./services/document-job-link";
import { customerActivityClusters, customerActivityMembers, jobForQuote } from "./services/business-chain";
import type { DocLine } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [
        testCustomer({ id: "cust-eli", name: "Eli Alm" }),
        testCustomer({ id: "cust-goran", name: "Göran Eriksson" }),
      ],
    })
  );
}

function draftQuote(customerId: string, title = "Altanbygge"): ReturnType<typeof createQuote> {
  const lines: DocLine[] = [
    labor({ id: "q-1", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 550 }),
  ];
  return createQuote({
    customerId,
    title,
    intro: "Enligt möte.",
    lines,
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
}

function draftInvoice(customerId: string, jobId?: string) {
  return createInvoice({
    customerId,
    jobId,
    type: "faktura",
    lines: [labor({ id: "i-1", description: "Arbete", qty: 2, unit: "tim", unitPrice: 550 })],
    rot: null,
  });
}

describe("document-job-link", () => {
  beforeEach(() => reset());

  it("CASE A: offert utan uppdrag visar Inte kopplat + kan kopplas", () => {
    const quote = draftQuote("cust-eli");
    const view = documentLinkView("quote", quote.id);
    assert.equal(view.job, null);
    assert.equal(view.canLink, true);
    assert.equal(view.jobs.length, 0);
    assert.equal(view.customerName, "Eli Alm");
  });

  it("CASE B: koppla offert till Elis uppdrag Altanbygge", () => {
    const quote = draftQuote("cust-eli");
    const job = createJob({ customerId: "cust-eli", title: "Altanbygge" });
    const result = linkDocumentToJob("quote", quote.id, job.id);
    assert.equal(result.jobTitle, "Altanbygge");
    assert.equal(getQuoteJobId(quote.id), job.id);
    assert.equal(db().jobs.find((j) => j.id === job.id)?.quoteId, quote.id);

    const view = documentLinkView("quote", quote.id);
    assert.equal(view.job?.title, "Altanbygge");
    assert.equal(view.job?.id, job.id);
    assert.match(view.job?.href ?? "", /\/uppdrag\//);
  });

  it("CASE C: fristående fakturautkast får Koppla till uppdrag", () => {
    const invoice = draftInvoice("cust-eli");
    const view = documentLinkView("invoice", invoice.id);
    assert.equal(view.job, null);
    assert.equal(view.canLink, true);
    assert.equal(invoice.jobId, undefined);
  });

  it("CASE D: faktura från uppdrag sätter relationen automatiskt", () => {
    const quote = draftQuote("cust-eli", "Altanbygge");
    quote.status = "godkand";
    quote.decidedAt = "2026-08-01T10:00:00.000Z";
    const job = startJobFromQuote(quote.id);
    assert.equal(quote.jobId, job.id);
    assert.equal(job.quoteId, quote.id);

    const invoice = createInvoiceForJob(job.id, "quote");
    assert.equal(invoice.jobId, job.id);
    const view = documentLinkView("invoice", invoice.id);
    assert.equal(view.job?.title, "Altanbygge");
  });

  it("CASE E: Elis faktura kan inte kopplas till Görans uppdrag", () => {
    const invoice = draftInvoice("cust-eli");
    const goranJob = createJob({ customerId: "cust-goran", title: "Köksrenovering" });
    assert.throws(
      () => linkDocumentToJob("invoice", invoice.id, goranJob.id),
      /samma kund/
    );
    assert.equal(invoice.jobId, undefined);
  });

  it("createInvoice avvisar jobId för annan kund (samma regel som manuell koppling)", () => {
    const goranJob = createJob({ customerId: "cust-goran", title: "Köksrenovering" });
    assert.throws(
      () => draftInvoice("cust-eli", goranJob.id),
      /samma kund/
    );
  });

  it("företag A: uppdrag som inte finns i tenant-lagret avvisas (isolering)", () => {
    const invoice = draftInvoice("cust-eli");
    assert.throws(
      () => linkDocumentToJob("invoice", invoice.id, "job-annat-foretag"),
      /finns inte/
    );
  });

  it("offert för Eli kan inte kopplas till Görans uppdrag", () => {
    const quote = draftQuote("cust-eli");
    const goranJob = createJob({ customerId: "cust-goran", title: "Köksrenovering" });
    assert.throws(() => linkDocumentToJob("quote", quote.id, goranJob.id), /samma kund/);
    assert.equal(quote.jobId, undefined);
  });

  it("väljaren visar bara uppdrag för samma kund", () => {
    createJob({ customerId: "cust-eli", title: "Altanbygge" });
    createJob({ customerId: "cust-eli", title: "Köksrenovering" });
    createJob({ customerId: "cust-goran", title: "Görans tak" });
    const eli = jobsForCustomerLink("cust-eli");
    assert.deepEqual(
      eli.map((j) => j.title).sort(),
      ["Altanbygge", "Köksrenovering"]
    );
    assert.equal(jobsForCustomerLink("cust-goran").length, 1);
  });

  it("inga uppdrag: tom lista så UI kan visa Skapa uppdrag", () => {
    const quote = draftQuote("cust-eli");
    const view = documentLinkView("quote", quote.id);
    assert.equal(view.jobs.length, 0);
    assert.equal(view.customerName, "Eli Alm");
  });

  it("skapa uppdrag och koppla i samma flöde", () => {
    const quote = draftQuote("cust-eli");
    const result = createJobAndLinkDocument("quote", quote.id, "Altanbygge");
    assert.equal(result.jobTitle, "Altanbygge");
    assert.equal(quote.jobId, result.jobId);
    const job = db().jobs.find((j) => j.id === result.jobId);
    assert.equal(job?.customerId, "cust-eli");
    assert.equal(job?.quoteId, quote.id);
  });

  it("koppla loss utkast: rensar quote.jobId och job.quoteId", () => {
    const quote = draftQuote("cust-eli");
    const job = createJob({ customerId: "cust-eli", title: "Altanbygge" });
    linkDocumentToJob("quote", quote.id, job.id);
    unlinkDocumentFromJob("quote", quote.id);
    assert.equal(quote.jobId, undefined);
    assert.equal(job.quoteId, undefined);
    assert.equal(documentLinkView("quote", quote.id).job, null);
  });

  it("koppla loss fakturautkast: rensar bara invoice.jobId", () => {
    const job = createJob({ customerId: "cust-eli", title: "Altanbygge" });
    const invoice = draftInvoice("cust-eli");
    linkDocumentToJob("invoice", invoice.id, job.id);
    assert.equal(invoice.jobId, job.id);
    unlinkDocumentFromJob("invoice", invoice.id);
    assert.equal(invoice.jobId, undefined);
  });

  it("skickad offert: får fästa koppling men inte losskoppla", () => {
    const quote = draftQuote("cust-eli");
    quote.status = "skickad";
    quote.sentAt = "2026-08-10T10:00:00.000Z";
    const job = createJob({ customerId: "cust-eli", title: "Altanbygge" });
    linkDocumentToJob("quote", quote.id, job.id);
    assert.equal(quote.jobId, job.id);
    assert.throws(() => unlinkDocumentFromJob("quote", quote.id), /kan inte tas bort/);
    const other = createJob({ customerId: "cust-eli", title: "Annat" });
    assert.throws(() => linkDocumentToJob("quote", quote.id, other.id), /kan inte ändras/);
  });

  it("utfärdad faktura: får fästa koppling men inte losskoppla eller byta", () => {
    const invoice = draftInvoice("cust-eli");
    invoice.status = "skickad";
    invoice.issuedAt = "2026-08-10T10:00:00.000Z";
    invoice.number = 1048;
    const job = createJob({ customerId: "cust-eli", title: "Altanbygge" });
    linkDocumentToJob("invoice", invoice.id, job.id);
    assert.equal(invoice.jobId, job.id);
    assert.throws(() => unlinkDocumentFromJob("invoice", invoice.id), /kan inte tas bort/);
    const other = createJob({ customerId: "cust-eli", title: "Annat" });
    assert.throws(() => linkDocumentToJob("invoice", invoice.id, other.id), /kan inte ändras/);
    const view = documentLinkView("invoice", invoice.id);
    assert.equal(view.canLink, false);
    assert.equal(view.canUnlink, false);
    assert.equal(view.job?.title, "Altanbygge");
  });

  it("Starta uppdrag från offert sätter quote.jobId utan extra Koppla till", () => {
    const quote = draftQuote("cust-eli", "Altanbygge");
    quote.status = "godkand";
    const job = startJobFromQuote(quote.id);
    assert.equal(jobForQuote(quote)?.id, job.id);
    assert.equal(quote.jobId, job.id);
    assert.equal(documentLinkView("quote", quote.id).job?.title, job.title);
  });

  it("faktura från redan kopplad offert ärver jobId", () => {
    const quote = draftQuote("cust-eli", "Altanbygge");
    quote.status = "godkand";
    const job = startJobFromQuote(quote.id);
    const invoice = createInvoiceFromQuote(quote.id);
    assert.equal(invoice.jobId, job.id);
    assert.equal(documentLinkView("invoice", invoice.id).job?.id, job.id);
  });

  it("aktivitetskedjan grupperar offert → uppdrag → faktura via sparade IDs", () => {
    const quote = draftQuote("cust-eli", "Altanbygge");
    quote.status = "godkand";
    const job = startJobFromQuote(quote.id);
    const invoice = createInvoiceForJob(job.id, "quote");
    invoice.number = 1048;
    const clusters = customerActivityClusters("cust-eli");
    assert.equal(clusters.length, 1);
    const members = customerActivityMembers(clusters[0], "cust-eli");
    assert.deepEqual(
      members.map((m) => m.kind),
      ["offert", "uppdrag", "faktura"]
    );
    assert.match(members[0].title, /Offert #/);
    assert.equal(members[1].title, "Altanbygge");
    assert.match(members[2].title, /1048/);
  });

  it("tilläggsoffert sätter bara quote.jobId – rör inte job.quoteId", () => {
    const first = draftQuote("cust-eli", "Altanbygge");
    first.status = "godkand";
    const job = startJobFromQuote(first.id);
    const extra = draftQuote("cust-eli", "Tillägg räcke");
    linkDocumentToJob("quote", extra.id, job.id);
    assert.equal(extra.jobId, job.id);
    assert.equal(job.quoteId, first.id);
  });
});

function getQuoteJobId(id: string): string | undefined {
  return db().quotes.find((q) => q.id === id)?.jobId;
}
