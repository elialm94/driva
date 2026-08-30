process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote, quoteDefaults } from "./services/quotes";
import {
  completeJob,
  createJob,
  createJobFromQuote,
  deleteOrArchiveJob,
  jobRemovalPolicy,
  reopenJob,
} from "./services/jobs";
import {
  actualEntries,
  addJobMaterial,
  deleteJobWorkEntry,
  inferJobPricingKind,
  jobInvoiceChoice,
  jobWorkComparison,
  plannedEntries,
  quotePrefillFromJob,
  registerJobTime,
  registeredUninvoicedAmount,
  uninvoicedActuals,
  updateJobWorkEntry,
} from "./services/job-work";
import {
  createInvoiceForJob,
  createInvoiceFromJobActuals,
  discardInvoice,
  issueInvoice,
} from "./services/invoices";
import { remainingToInvoiceForJob } from "./services/attention";
import { getJob, invoiceTotals } from "./services/data";
import { completeJobDraft, registerJobTimeDraft, reopenJobDraft, requestDeleteOrArchiveJob } from "./ai/domain";
import { confirmPendingAction } from "./services/assistant";
import { jobMoney } from "./services/job-economy";
import { listJobsForTable } from "./services/job-list";
import type { DocLine } from "./types";

function reset() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", personalIdentityNumber: "19850515-1234" })] }));
}

function approvedQuote(lines: DocLine[], over: { rot?: "rot" | null; jobId?: string } = {}) {
  const quote = createQuote({
    customerId: "cust-1",
    jobId: over.jobId,
    title: "Testjobb",
    intro: "Enligt överenskommelse",
    lines,
    rot: over.rot === "rot" ? { type: "rot" } : null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  return quote;
}

describe("Uppdrag: avtalat vs registrerat vs fakturerat", () => {
  beforeEach(() => reset());

  it("godkänd offert → uppdrag importerar planned baseline, inga falska actuals", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 20, unit: "tim", unitPrice: 550 }),
      labor({ id: "q-mat", kind: "material", description: "Virke", qty: 1, unit: "st", unitPrice: 4000 }),
    ]);
    const job = createJobFromQuote(quote);
    const planned = plannedEntries(job.id);
    assert.equal(planned.length, 2);
    assert.equal(planned.every((e) => e.role === "planned"), true);
    assert.equal(planned.every((e) => e.source === "quote"), true);
    assert.equal(actualEntries(job.id).length, 0);
    const hours = planned.find((e) => e.type === "labor");
    assert.equal(hours?.qty, 20);
    assert.equal(hours?.quotedLineItemId, "q-tim");
  });

  it("registrera tid under och över offerten – aldrig blockerat", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 20, unit: "tim", unitPrice: 550 }),
    ]);
    const job = createJobFromQuote(quote);
    const remainingBefore = remainingToInvoiceForJob(job.id);
    registerJobTime(job.id, { hours: 8 });
    let cmp = jobWorkComparison(job.id);
    assert.equal(cmp.laborHoursRegistered, 8);
    assert.equal(cmp.laborHoursQuoted, 20);
    assert.equal(cmp.overageLabel, null);
    assert.equal(actualEntries(job.id)[0].isExtra, false);
    assert.equal(remainingToInvoiceForJob(job.id), remainingBefore);

    registerJobTime(job.id, { hours: 15 });
    cmp = jobWorkComparison(job.id);
    assert.equal(cmp.laborHoursRegistered, 23);
    assert.match(cmp.overageLabel ?? "", /3/);
    assert.match(cmp.overageLabel ?? "", /timmar jämfört med offert/);
  });

  it("extra material markeras som tillägg", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 550 }),
      labor({ id: "q-mat", kind: "material", description: "Virke", qty: 1, unit: "st", unitPrice: 2000 }),
    ]);
    const job = createJobFromQuote(quote);
    const extra = addJobMaterial(job.id, { description: "Extra gångjärn", qty: 4, unit: "st", unitPrice: 80 });
    assert.equal(extra.isExtra, true);
    const same = addJobMaterial(job.id, { description: "Virke", qty: 1, unit: "st", unitPrice: 2000 });
    assert.equal(same.isExtra, false);
    assert.equal(inferJobPricingKind(job.id), "hybrid");
  });

  it("fast pris + mer registrerat än offert → faktura enligt offert rör inte actuals", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 800 }),
    ]);
    const job = createJobFromQuote(quote);
    registerJobTime(job.id, { hours: 15 });
    assert.equal(inferJobPricingKind(job.id), "fast_pris");
    const inv = createInvoiceForJob(job.id, "quote");
    assert.equal(inv.status, "utkast");
    assert.equal(inv.lines.some((l) => l.qty === 10 && l.kind === "arbete"), true);
    assert.equal(uninvoicedActuals(job.id).length, 1);
    assert.equal(inv.lines.reduce((s, l) => s + l.qty, 0) !== 15, true);
  });

  it("löpande utan offert → faktura från actuals", () => {
    const job = createJob({ customerId: "cust-1", title: "Jour" });
    registerJobTime(job.id, { hours: 3, unitPrice: 600, description: "Jourarbete" });
    addJobMaterial(job.id, { description: "Skruv", qty: 1, unitPrice: 100 });
    assert.equal(inferJobPricingKind(job.id), "lopande");
    const inv = createInvoiceForJob(job.id, "actuals");
    assert.equal(inv.status, "utkast");
    assert.equal(inv.lines.length, 2);
    assert.equal(uninvoicedActuals(job.id).length, 0);
    assert.equal(actualEntries(job.id).every((e) => e.invoiceId === inv.id), true);
  });

  it("hybrid: offert + tillägg tar med extra actuals", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 8, unit: "tim", unitPrice: 500 }),
    ]);
    const job = createJobFromQuote(quote);
    const extra = addJobMaterial(job.id, { description: "Extra list", qty: 1, unitPrice: 2000 });
    assert.equal(inferJobPricingKind(job.id), "hybrid");
    const inv = createInvoiceForJob(job.id, "quote_plus_extras");
    assert.equal(inv.lines.some((l) => /extra list/i.test(l.description)), true);
    assert.equal(extra.invoiceId, inv.id);
    assert.equal(actualEntries(job.id).filter((e) => !e.isExtra).every((e) => !e.invoiceId), true);
  });

  it("delfaktura av actuals – andra fakturan tar inte redan kopplade poster", () => {
    const job = createJob({ customerId: "cust-1", title: "Löpande" });
    const a = registerJobTime(job.id, { hours: 2, unitPrice: 500, description: "Dag 1" });
    const b = registerJobTime(job.id, { hours: 3, unitPrice: 500, description: "Dag 2" });
    const first = createInvoiceFromJobActuals(job.id, "anvandare", [a.id]);
    assert.equal(a.invoiceId, first.id);
    assert.equal(b.invoiceId, undefined);
    const second = createInvoiceFromJobActuals(job.id);
    assert.equal(second.id !== first.id, true);
    assert.equal(b.invoiceId, second.id);
    assert.equal(second.lines.length, 1);
    assert.match(second.lines[0].description, /Dag 2/);
  });

  it("skapa offert efter att uppdraget finns – prefill från registrerat", () => {
    const job = createJob({ customerId: "cust-1", title: "Bokhylla", description: "Platsbyggd bokhylla" });
    registerJobTime(job.id, { hours: 4, unitPrice: 550, description: "Montering" });
    const prefill = quotePrefillFromJob(job.id);
    assert.ok(prefill);
    assert.equal(prefill.title, "Bokhylla");
    assert.equal(prefill.intro, "Platsbyggd bokhylla");
    assert.equal(prefill.lines.length, 1);
    assert.equal(prefill.lines[0].qty, 4);
    const quote = createQuote({
      customerId: "cust-1",
      jobId: job.id,
      title: prefill.title,
      intro: prefill.intro,
      lines: prefill.lines,
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    assert.equal(quote.jobId, job.id);
    assert.equal(actualEntries(job.id).length, 1);
  });

  it("godkänn offert efter att actuals finns – importerar planned, duplicerar inte actuals", () => {
    const job = createJob({ customerId: "cust-1", title: "Altan" });
    registerJobTime(job.id, { hours: 5, unitPrice: 550, description: "Rivning" });
    const quote = approvedQuote(
      [labor({ id: "q-tim", kind: "arbete", description: "Altanarbete", qty: 20, unit: "tim", unitPrice: 550 })],
      { jobId: job.id }
    );
    const linked = createJobFromQuote(quote);
    assert.equal(linked.id, job.id);
    assert.equal(plannedEntries(job.id).length, 1);
    assert.equal(actualEntries(job.id).length, 1);
    assert.equal(actualEntries(job.id)[0].qty, 5);
  });

  it("ROT-faktura från labor/material behåller skillnaden", () => {
    const quote = approvedQuote(
      [
        labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 800 }),
        labor({ id: "q-mat", kind: "material", description: "Luckor", qty: 1, unit: "st", unitPrice: 4000 }),
      ],
      { rot: "rot" }
    );
    const job = createJobFromQuote(quote);
    registerJobTime(job.id, { hours: 10 });
    addJobMaterial(job.id, { description: "Luckor", qty: 1, unitPrice: 4000 });
    const inv = createInvoiceForJob(job.id, "actuals");
    assert.equal(inv.rot?.type, "rot");
    const laborLine = inv.lines.find((l) => l.kind === "arbete");
    const matLine = inv.lines.find((l) => l.kind === "material");
    assert.ok(laborLine);
    assert.ok(matLine);
    const t = invoiceTotals(inv);
    assert.ok(t.laborInclVat > 0);
    assert.ok(t.deduction > 0);
    assert.ok(t.laborInclVat < t.total);
  });

  it("AI-verktyg registrerar tid på uppdraget", () => {
    const job = createJob({ customerId: "cust-1", title: "AI-jobb" });
    const result = registerJobTimeDraft({ jobId: job.id, hours: 2, description: "Målning" });
    assert.equal(result.ok, true);
    const entries = actualEntries(job.id);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].qty, 2);
    assert.equal(entries[0].source, "ai");
    assert.equal(entries[0].description, "Målning");
  });

  it("cross-tenant: okänt uppdrag nekas", () => {
    assert.throws(() => registerJobTime("job-annan-verksamhet", { hours: 1 }), /finns inte/);
    assert.throws(() => addJobMaterial("job-annan-verksamhet", { description: "X", qty: 1, unitPrice: 10 }), /finns inte/);
  });

  it("utfärdad faktura låser actuals – utkast kan kastas och faktureras igen", () => {
    const job = createJob({ customerId: "cust-1", title: "Lås" });
    const entry = registerJobTime(job.id, { hours: 2, unitPrice: 500 });
    const draft = createInvoiceForJob(job.id, "actuals");
    discardInvoice(draft.id);
    assert.equal(entry.invoiceId, undefined);
    const again = createInvoiceForJob(job.id, "actuals");
    issueInvoice(again.id);
    assert.throws(() => updateJobWorkEntry(entry.id, { qty: 4 }), /fakturerad/i);
    assert.throws(() => deleteJobWorkEntry(entry.id), /fakturerad/i);
    assert.equal(registeredUninvoicedAmount(job.id), 0);
  });

  it("kasta utkast frigör actuals så de inte dubbelfaktureras", () => {
    const job = createJob({ customerId: "cust-1", title: "Utkast" });
    registerJobTime(job.id, { hours: 1, unitPrice: 400 });
    const first = createInvoiceForJob(job.id, "actuals");
    discardInvoice(first.id);
    const second = createInvoiceForJob(job.id, "actuals");
    assert.equal(second.lines.length, 1);
    assert.notEqual(second.id, first.id);
  });

  it("faktura-väljaren: offert, registrerat och tom – aldrig blandat, löpande rekommenderar actuals", () => {
    const job = createJob({ customerId: "cust-1", title: "Jour" });
    registerJobTime(job.id, { hours: 2, unitPrice: 500, description: "Jour" });
    const choice = jobInvoiceChoice(job.id);
    assert.equal(choice.pricingKind, "lopande");
    assert.deepEqual(choice.options.map((o) => o.basis), ["actuals", "empty"]);
    assert.equal(choice.recommendedBasis, "actuals");
    assert.equal(choice.autoBasis, "actuals");
    assert.equal(choice.options.find((o) => o.basis === "actuals")?.title, "Ofakturerat arbete & material");
    assert.equal(choice.options.find((o) => o.basis === "empty")?.title, "Välj själv");
    assert.equal(choice.options.some((o) => o.basis === "quote"), false);
  });

  it("faktura-väljaren: godkänd offert visar kvar separat från registrerat", () => {
    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 10, unit: "tim", unitPrice: 800 }),
    ]);
    const job = createJobFromQuote(quote);
    registerJobTime(job.id, { hours: 12 });
    addJobMaterial(job.id, { description: "Extra gångjärn", qty: 1, unitPrice: 200 });
    const choice = jobInvoiceChoice(job.id);
    assert.deepEqual(choice.options.map((o) => o.basis), ["quote", "actuals", "empty"]);
    assert.equal(choice.autoBasis, null);
    assert.equal(choice.options.some((o) => (o as { basis: string }).basis === "quote_plus_extras"), false);
    const quoteOpt = choice.options.find((o) => o.basis === "quote");
    const actualsOpt = choice.options.find((o) => o.basis === "actuals");
    assert.ok(quoteOpt);
    assert.ok(actualsOpt);
    assert.match(quoteOpt.hint, /Utgår från offert #/);
    assert.ok((actualsOpt.extrasAmount ?? 0) > 0);
    assert.equal(quoteOpt.amount, remainingToInvoiceForJob(job.id));
  });

  it("offertutkast blockerar inte faktura och kopplas inte som godkänd", () => {
    const job = createJob({ customerId: "cust-1", title: "Utan godkännande" });
    const defaults = quoteDefaults();
    const draft = createQuote({
      customerId: "cust-1",
      jobId: job.id,
      title: "Utkast",
      intro: "",
      lines: [labor({ description: "Snickeri", qty: 2, unit: "tim", unitPrice: 800 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.equal(draft.status, "utkast");
    const choice = jobInvoiceChoice(job.id);
    assert.equal(choice.options.some((o) => o.basis === "quote"), false);
    assert.ok(choice.unapprovedQuoteNotice);
    assert.equal(choice.options.some((o) => o.basis === "empty"), true);
    assert.throws(() => createInvoiceForJob(job.id, "quote"), /inte godkänd/);
    const inv = createInvoiceForJob(job.id, "empty");
    assert.equal(inv.quoteId, undefined);
    assert.equal(inv.jobId, job.id);
  });

  it("tom faktura: kund och uppdrag ifyllt, inga rader, utkast", () => {
    const job = createJob({ customerId: "cust-1", title: "Tom" });
    const inv = createInvoiceForJob(job.id, "empty");
    assert.equal(inv.status, "utkast");
    assert.equal(inv.customerId, "cust-1");
    assert.equal(inv.jobId, job.id);
    assert.equal(inv.lines.length, 0);
    assert.equal(inv.number, null);
  });

  it("utkast räknas inte som Fakturerat", () => {
    const job = createJob({ customerId: "cust-1", title: "Utkast-ekonomi" });
    registerJobTime(job.id, { hours: 2, unitPrice: 500 });
    const draft = createInvoiceForJob(job.id, "actuals");
    const money = jobMoney(job.id);
    assert.equal(money.invoicedIssued, 0);
    assert.ok(money.invoiced > 0);
    issueInvoice(draft.id);
    assert.ok(jobMoney(job.id).invoicedIssued > 0);
  });

  it("klart och återöppna rör inte fakturor", () => {
    const job = createJob({ customerId: "cust-1", title: "Klart" });
    registerJobTime(job.id, { hours: 1, unitPrice: 400 });
    const inv = createInvoiceForJob(job.id, "actuals");
    issueInvoice(inv.id);
    const issuedAt = { ...getJob(job.id)! };
    completeJob(job.id);
    assert.equal(getJob(job.id)?.status, "klart");
    reopenJob(job.id);
    const after = getJob(job.id)!;
    assert.notEqual(after.status, "klart");
    assert.equal(after.completedAt, undefined);
    assert.ok(db().activity.some((a) => a.text === "Uppdrag återöppnades."));
    assert.equal(db().invoices.find((i) => i.id === inv.id)?.status, "skickad");
    assert.equal(issuedAt.quoteId, after.quoteId);
  });

  it("tomt uppdrag raderas, uppdrag med godkänd offert arkiveras", () => {
    const empty = createJob({ customerId: "cust-1", title: "Tomt" });
    assert.equal(jobRemovalPolicy(empty.id).kind, "delete");
    assert.equal(deleteOrArchiveJob(empty.id).kind, "deleted");
    assert.equal(getJob(empty.id), undefined);

    const quote = approvedQuote([
      labor({ id: "q-tim", kind: "arbete", description: "Snickeri", qty: 4, unit: "tim", unitPrice: 600 }),
    ]);
    const job = createJobFromQuote(quote);
    assert.equal(jobRemovalPolicy(job.id).kind, "archive");
    assert.equal(deleteOrArchiveJob(job.id).kind, "archived");
    assert.equal(getJob(job.id)?.archivedAt != null, true);
    assert.equal(quote.status, "godkand");
    const aktiva = listJobsForTable({ lifecycle: "aktiva" });
    assert.equal(aktiva.rows.some((r) => r.id === job.id), false);
    const alla = listJobsForTable({ lifecycle: "alla" });
    assert.equal(alla.rows.some((r) => r.id === job.id), true);
    const arkiv = listJobsForTable({ lifecycle: "arkiverade" });
    assert.equal(arkiv.rows.some((r) => r.id === job.id), true);
  });

  it("AI complete/reopen/delete använder samma tjänster, bekräftelse för borttagning", async () => {
    const job = createJob({ customerId: "cust-1", title: "AI-liv" });
    const done = completeJobDraft(job.id);
    assert.equal(done.ok, true);
    assert.equal(getJob(job.id)?.status, "klart");
    const reopened = reopenJobDraft(job.id);
    assert.equal(reopened.ok, true);
    assert.notEqual(getJob(job.id)?.status, "klart");

    const ask = requestDeleteOrArchiveJob(job.id);
    assert.equal(ask.ok, true);
    assert.equal(ask.forModel.pendingConfirmation, true);
    assert.equal(getJob(job.id)?.id, job.id);
    const pending = db().pendingActions.find((a) => a.type === "ta_bort_uppdrag");
    assert.ok(pending);
    await confirmPendingAction(pending.id);
    assert.equal(getJob(job.id), undefined);
  });
});
