process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { registerJobTime, addJobMaterial, uninvoicedActuals } from "./services/job-work";
import {
  createInvoice,
  createInvoiceFromJobActuals,
  createPartInvoiceForQuote,
  creditInvoice,
  discardInvoice,
  issueInvoice,
  updateInvoice,
} from "./services/invoices";
import {
  BillingConflictError,
  allocationsForInvoice,
  liveAllocationForSource,
  paymentPlanPartSourceId,
  sourceBillingState,
} from "./services/billing-allocation";
import { nextPaymentPlanPartForQuote, paymentPlanPartAlreadyInvoiced } from "./services/business-chain";
import { invoiceTotals } from "./services/data";
import { quoteVersionHash, canonicalPaymentPlan } from "./hash";
import { paymentPlanAmounts, paymentPlanIssue, paymentPlanPartKind } from "./payment-plan";
import type { DocLine, PaymentPlanPart, QuoteVersion } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1", name: "Test Testsson", email: "test@example.com" })],
    })
  );
}

function approvedQuote(lines: DocLine[], plan?: PaymentPlanPart[]) {
  const quote = createQuote({
    customerId: "cust-1",
    title: "Testjobb",
    lines,
    rot: null,
    paymentPlan: plan ?? [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  return quote;
}

describe("Faktureringsallokering: källrad → fakturarad", () => {
  beforeEach(() => reset());

  it("utkast från registrerat arbete allokerar varje post; utfärdande låser, kastat utkast släpper", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 3 });
    const m1 = addJobMaterial(job.id, { description: "Skruv", qty: 2, unitPrice: 100 });

    const draft = createInvoiceFromJobActuals(job.id);
    const allocs = allocationsForInvoice(draft.id);
    assert.equal(allocs.length, 2);
    assert.ok(allocs.every((a) => a.status === "draft" && a.jobId === job.id && a.sourceType === "work_entry"));
    assert.deepEqual(new Set(allocs.map((a) => a.sourceId)), new Set([t1.id, m1.id]));
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "draft");
    assert.equal(uninvoicedActuals(job.id).length, 0);

    discardInvoice(draft.id);
    assert.equal(allocationsForInvoice(draft.id).length, 0);
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "unbilled");
    assert.equal(uninvoicedActuals(job.id).length, 2);

    const second = createInvoiceFromJobActuals(job.id);
    issueInvoice(second.id);
    const issued = allocationsForInvoice(second.id);
    assert.ok(issued.every((a) => a.status === "invoiced" && a.invoicedAt));
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: m1.id }).status, "invoiced");
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: m1.id }).invoiceNumber, second.number);
  });

  it("strikt allokering vägrar fakturera samma källa två gånger och lämnar inget halvt utkast", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 3 });
    const first = createInvoiceFromJobActuals(job.id);
    const before = db().invoices.length;

    const line: DocLine = {
      id: "l-dup",
      kind: "arbete",
      description: "Samma tid igen",
      qty: 3,
      unit: "tim",
      unitPrice: 500,
      vatRate: 25,
      sourceKind: "JOB_TIME_ENTRY",
      sourceId: t1.id,
    };
    assert.throws(
      () =>
        createInvoice({
          customerId: "cust-1",
          jobId: job.id,
          type: "faktura",
          lines: [line],
          rot: null,
          strictAllocation: true,
        }),
      (err: unknown) => err instanceof BillingConflictError && err.invoiceId === first.id
    );
    assert.equal(db().invoices.length, before);
    assert.equal(allocationsForInvoice(first.id).length, 1);

    // Icke-strikt (äldre flöden): utkastet skapas men källan allokeras inte igen.
    const loose = createInvoice({ customerId: "cust-1", jobId: job.id, type: "faktura", lines: [line], rot: null });
    assert.equal(allocationsForInvoice(loose.id).length, 0);
    assert.equal(liveAllocationForSource({ sourceType: "work_entry", sourceId: t1.id })?.invoiceId, first.id);
  });

  it("redigerat utkast: borttagen rad frisläpper källan, ny rad reserverar", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 3 });
    const t2 = registerJobTime(job.id, { hours: 2 });
    const draft = createInvoiceFromJobActuals(job.id);
    const keep = draft.lines.find((l) => l.sourceId === t1.id)!;
    updateInvoice(draft.id, { lines: [keep], rot: null });
    const live = allocationsForInvoice(draft.id).filter((a) => a.status !== "released");
    assert.equal(live.length, 1);
    assert.equal(live[0].sourceId, t1.id);
    const released = allocationsForInvoice(draft.id).find((a) => a.sourceId === t2.id);
    assert.equal(released?.status, "released");
    assert.equal(released?.releaseReason, "rad_borttagen");
  });

  it("betalplansdel allokeras en gång; fast förskott styr beloppet och sista delen tar resten", () => {
    const quote = approvedQuote(
      [labor({ id: "q1", qty: 100, unitPrice: 500 })], // 50 000 exkl → 62 500 inkl
      [
        { label: "Förskott vid beställning", percent: 0, amount: 20000, kind: "forskott" },
        { label: "När stommen är klar", percent: 30 },
        { label: "När arbetet är klart", percent: 70 },
      ]
    );
    const first = nextPaymentPlanPartForQuote(quote.id);
    assert.equal(first?.index, 0);
    assert.equal(first?.amount, 20000);

    const inv1 = createPartInvoiceForQuote(quote.id, 0);
    assert.equal(invoiceTotals(inv1).total, 20000);
    const a1 = allocationsForInvoice(inv1.id);
    assert.equal(a1.length, 1);
    assert.equal(a1[0].sourceType, "payment_plan_part");
    assert.equal(a1[0].sourceId, paymentPlanPartSourceId(quote.id, 0));
    assert.equal(paymentPlanPartAlreadyInvoiced(quote.id, 0), true);
    assert.throws(() => createPartInvoiceForQuote(quote.id, 0), /redan fakturerad/);

    const second = nextPaymentPlanPartForQuote(quote.id);
    assert.equal(second?.index, 1);
    assert.equal(second?.amount, Math.round(62500 * 0.3));
    const inv2 = createPartInvoiceForQuote(quote.id, 1);
    issueInvoice(inv1.id);
    issueInvoice(inv2.id);

    const last = nextPaymentPlanPartForQuote(quote.id);
    assert.equal(last?.index, 2);
    assert.equal(last?.isLast, true);
    // Resten – inte 70 % rakt av (som vore 43 750 och gav dubbelfakturering).
    assert.equal(last?.amount, 62500 - 20000 - 18750);
  });

  it("hel kreditering frisläpper källorna så de kan faktureras igen; delkredit gör det inte", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 4 });
    const inv = createInvoiceFromJobActuals(job.id);
    issueInvoice(inv.id);
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "invoiced");

    creditInvoice(inv.id, "anvandare", { amountInclVat: 500 });
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "invoiced");
    assert.equal(allocationsForInvoice(inv.id)[0].status, "invoiced");
    assert.throws(() => createInvoiceFromJobActuals(job.id), /inget ofakturerat/);
  });

  it("hel kreditering: allokeringen blir released och posten är ofakturerad igen", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 4 });
    const inv = createInvoiceFromJobActuals(job.id);
    issueInvoice(inv.id);
    creditInvoice(inv.id);
    const a = allocationsForInvoice(inv.id)[0];
    assert.equal(a.status, "released");
    assert.equal(a.releaseReason, "faktura_krediterad");
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "unbilled");
    assert.equal(uninvoicedActuals(job.id).length, 1);
  });

  it("äldre fakturor utan allokeringar räknas ändå som fakturerade via radproveniens", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 10, unitPrice: 500 })]);
    const job = createJobFromQuote(quote);
    const t1 = registerJobTime(job.id, { hours: 4 });
    const inv = createInvoiceFromJobActuals(job.id);
    // Simulera en faktura från tiden före tabellen fanns.
    db().billingAllocations = [];
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "draft");
    issueInvoice(inv.id);
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).status, "invoiced");
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: t1.id }).invoiceId, inv.id);
  });
});

describe("Betalplan: beräkningar och hash", () => {
  it("sista delen får resten så summan alltid blir totalen", () => {
    const plan: PaymentPlanPart[] = [
      { label: "A", percent: 33 },
      { label: "B", percent: 33 },
      { label: "C", percent: 34 },
    ];
    const amounts = paymentPlanAmounts(plan, 10001);
    assert.equal(amounts.reduce((s, a) => s + a, 0), 10001);
    assert.equal(amounts[0], 3300);
    assert.equal(amounts[2], 10001 - 3300 - 3300);
  });

  it("fast förskott + procent på resten", () => {
    const plan: PaymentPlanPart[] = [
      { label: "Förskott", percent: 0, amount: 5000 },
      { label: "Slut", percent: 100 },
    ];
    assert.deepEqual(paymentPlanAmounts(plan, 12000), [5000, 7000]);
    assert.equal(paymentPlanIssue(plan, 12000), null);
    assert.match(paymentPlanIssue(plan, 4000) ?? "", /överstiga/);
    assert.equal(paymentPlanPartKind(plan, 0), "forskott");
    assert.equal(paymentPlanPartKind(plan, 1), "slutbetalning");
  });

  it("procentplan måste summera till 100", () => {
    assert.match(paymentPlanIssue([{ label: "A", percent: 30 }, { label: "B", percent: 60 }]) ?? "", /100 %/);
    assert.equal(paymentPlanIssue([{ label: "A", percent: 30 }, { label: "B", percent: 70 }]), null);
  });

  it("contentHash är oförändrat för äldre planer och oberoende av nyckelordning för nya fält", () => {
    const base: QuoteVersion = {
      id: "v1",
      quoteId: "q1",
      version: 1,
      title: "T",
      lines: [],
      rot: null,
      paymentPlan: [{ label: "Klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    // Samma kanoniska sträng som före förändringen: {label, percent} i den ordningen.
    assert.deepEqual(canonicalPaymentPlan(base.paymentPlan), [{ label: "Klart", percent: 100 }]);
    assert.deepEqual(Object.keys(canonicalPaymentPlan(base.paymentPlan)[0]), ["label", "percent"]);

    const a = { ...base, paymentPlan: [{ label: "F", percent: 0, amount: 5000, kind: "forskott" as const }, { label: "S", percent: 100 }] };
    const reordered = {
      ...base,
      paymentPlan: [
        JSON.parse('{"kind":"forskott","amount":5000,"percent":0,"label":"F"}') as PaymentPlanPart,
        { percent: 100, label: "S" } as PaymentPlanPart,
      ],
    };
    assert.equal(quoteVersionHash(a), quoteVersionHash(reordered));
    assert.notEqual(quoteVersionHash(a), quoteVersionHash(base));
  });
});
