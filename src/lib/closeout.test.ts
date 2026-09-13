process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote, createJob } from "./services/jobs";
import { addJobMaterial, registerJobTime } from "./services/job-work";
import { createPartInvoiceForQuote, creditInvoice, issueInvoice } from "./services/invoices";
import { approveJobChange, createJobChange, sendJobChange } from "./services/job-changes";
import {
  CloseoutError,
  clearBillingDeferral,
  closeoutBasis,
  completeJobCloseout,
  createCloseoutInvoiceDraft,
  existingCloseoutDraft,
  reopenJobCloseout,
  setBillingDeferral,
} from "./services/closeout";
import { allocationsForInvoice, sourceBillingState } from "./services/billing-allocation";
import { nextPaymentPlanPartForQuote } from "./services/business-chain";
import { invoiceTotals } from "./services/data";
import { auditTrail } from "./accounting/audit";
import type { DocLine, PaymentPlanPart } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1", name: "Anna Andersson", email: "anna@example.com" })],
    })
  );
}

const PLAN_30_70: PaymentPlanPart[] = [
  { label: "Vid start", percent: 30, kind: "forskott" },
  { label: "När arbetet är klart", percent: 70, kind: "slutbetalning" },
];

function approvedQuote(lines: DocLine[], plan: PaymentPlanPart[] = PLAN_30_70, rot: "rot" | null = null) {
  const quote = createQuote({
    customerId: "cust-1",
    title: "Kök",
    lines,
    rot: rot ? { type: rot } : null,
    paymentPlan: plan,
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  return quote;
}

/** Offert 20 000 exkl = 25 000 inkl; förskott 30 % fakturerat och utfärdat (7 500). */
function kitchenJob() {
  const quote = approvedQuote([labor({ id: "q1", qty: 40, unitPrice: 500 })]);
  const job = createJobFromQuote(quote);
  job.startDate = "2026-08-02T07:00:00.000Z";
  const part = createPartInvoiceForQuote(quote.id, 0);
  issueInvoice(part.id);
  const extra = addJobMaterial(job.id, { description: "Extra list", qty: 1, unitPrice: 1000 });
  extra.isExtra = true;
  const inScope = registerJobTime(job.id, { hours: 8 });
  inScope.isExtra = false;
  const change = sendJobChange(
    createJobChange(job.id, {
      title: "Flyttat eluttag",
      description: "",
      lines: [labor({ id: "c1", description: "Urtag", qty: 2, unitPrice: 1000 })],
    }).id
  );
  approveJobChange({ token: change.token, name: "Anna" });
  return { quote, job, part, extra, inScope, change };
}

describe("Avsluta uppdrag: underlag, beslut och fakturautkast", () => {
  beforeEach(() => reset());

  it("underlaget listar rest enligt offert, godkända ändringar och tillägg – inte arbete inom offerten", () => {
    const { job, extra, inScope, change } = kitchenJob();
    const basis = closeoutBasis(job.id);
    const keys = basis.items.map((i) => i.key);
    assert.ok(keys.includes(`quote_remainder:${basis.quote!.id}`));
    assert.ok(keys.includes(`change_line:${change.lines[0].id}`));
    assert.ok(keys.includes(`work_entry:${extra.id}`));
    assert.ok(!keys.includes(`work_entry:${inScope.id}`));

    const remainder = basis.items.find((i) => i.sourceType === "quote_remainder")!;
    assert.equal(remainder.amountInclVat, 25000 - 7500);
    assert.equal(remainder.state, "fakturerbar");
    assert.equal(basis.totals.billable, 17500 + 2500 + 1250);
    assert.ok(basis.modes.some((m) => m.mode === "slutfaktura" && m.recommended));
    assert.equal(basis.checks.pendingChanges.length, 0);
  });

  it("slutfaktura: ett utkast med rest + ändring + tillägg, spårbart och idempotent", () => {
    const { job, quote, extra, change } = kitchenJob();
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(draft.status, "utkast");
    assert.equal(draft.type, "slutfaktura");
    assert.equal(invoiceTotals(draft).total, 17500 + 2500 + 1250);

    const allocs = allocationsForInvoice(draft.id);
    assert.deepEqual(
      new Set(allocs.map((a) => a.sourceType)),
      new Set(["payment_plan_part", "change_line", "work_entry"])
    );
    assert.equal(sourceBillingState({ sourceType: "change_line", sourceId: change.lines[0].id }).status, "draft");
    assert.equal(sourceBillingState({ sourceType: "work_entry", sourceId: extra.id }).status, "draft");
    assert.equal(extra.invoiceId, draft.id);

    // Andra klicket skapar inte ett andra utkast.
    const again = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(again.id, draft.id);
    assert.equal(existingCloseoutDraft(job.id)?.id, draft.id);
    assert.equal(db().invoices.filter((i) => i.status === "utkast").length, 1);

    // Underlaget visar nu allt som "utkast" och ingenting fakturerbart.
    const basis = closeoutBasis(job.id);
    assert.ok(basis.items.every((i) => i.state === "utkast"));
    assert.equal(basis.totals.billable, 0);
    // Offertens sista del är täckt: ingen "nästa del" kvar när utkastet utfärdas.
    issueInvoice(draft.id);
    assert.equal(nextPaymentPlanPartForQuote(quote.id), null);
  });

  it("tid registrerad på en ändring faktureras via ändringen – aldrig som egen post", () => {
    const { job, change } = kitchenJob();
    const logged = registerJobTime(job.id, { hours: 2, description: "Urtag (utfört)" });
    logged.isExtra = true;
    logged.changeId = change.id;

    const basis = closeoutBasis(job.id);
    assert.ok(!basis.items.some((i) => i.key === `work_entry:${logged.id}`));
    const changeItem = basis.items.find((i) => i.sourceType === "change_line")!;
    assert.ok(changeItem.detail?.includes("2 tim registrerade"), changeItem.detail);
    assert.equal(basis.totals.billable, 17500 + 2500 + 1250);

    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(invoiceTotals(draft).total, 17500 + 2500 + 1250);
    // Posten räknas som fakturerad genom ändringens rad.
    assert.equal(logged.invoiceId, draft.id);
    assert.ok(!draft.lines.some((l) => l.sourceId === logged.id));
  });

  it("delkredit på förskottet ökar resten exakt lika mycket", () => {
    const { job, part } = kitchenJob();
    creditInvoice(part.id, "anvandare", { amountInclVat: 2000 });
    const remainder = closeoutBasis(job.id).items.find((i) => i.sourceType === "quote_remainder")!;
    assert.equal(remainder.amountInclVat, 25000 - 7500 + 2000);
  });

  it("beslut: 'hantera senare' och 'inte fakturerbart' sparas, utesluts ur utkastet och kan tas tillbaka", () => {
    const { job, extra, change } = kitchenJob();
    setBillingDeferral(job.id, { sourceType: "work_entry", sourceId: extra.id }, "hantera_senare", "Vänta på kvitto");
    setBillingDeferral(job.id, { sourceType: "change_line", sourceId: change.lines[0].id }, "inte_fakturerbart");
    let basis = closeoutBasis(job.id);
    assert.equal(basis.items.find((i) => i.sourceId === extra.id)?.state, "hantera_senare");
    assert.equal(basis.items.find((i) => i.sourceId === extra.id)?.deferral?.note, "Vänta på kvitto");
    assert.equal(basis.items.find((i) => i.sourceId === change.lines[0].id)?.state, "inte_fakturerbart");
    assert.equal(basis.totals.deferred, 1250);
    assert.equal(basis.totals.notBillable, 2500);
    assert.equal(basis.totals.billable, 17500);
    assert.equal(job.closeout?.events.filter((e) => e.kind === "beslut_hantera_senare").length, 1);
    assert.equal(job.closeout?.events.filter((e) => e.kind === "beslut_inte_fakturerbart").length, 1);

    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(invoiceTotals(draft).total, 17500);
    assert.equal(extra.invoiceId, undefined);

    clearBillingDeferral(job.id, { sourceType: "work_entry", sourceId: extra.id });
    basis = closeoutBasis(job.id);
    assert.equal(basis.items.find((i) => i.sourceId === extra.id)?.state, "fakturerbar");
    assert.ok(job.billingDeferrals?.find((d) => d.sourceId === extra.id)?.resolvedAt);
  });

  it("valda poster styr: löpande utan offertens rest, bara det som kryssats", () => {
    const { job, extra, change } = kitchenJob();
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "lopande", includeKeys: [`work_entry:${extra.id}`] });
    assert.equal(draft.type, "faktura");
    assert.equal(invoiceTotals(draft).total, 1250);
    assert.equal(sourceBillingState({ sourceType: "change_line", sourceId: change.lines[0].id }).status, "unbilled");
    const remainder = closeoutBasis(job.id).items.find((i) => i.sourceType === "quote_remainder")!;
    assert.equal(remainder.state, "fakturerbar");
    // Tillägget på det löpande utkastet minskar inte offertens rest.
    assert.equal(remainder.amountInclVat, 17500);
  });

  it("delfaktura tar nästa del i betalplanen och lämnar resten", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 40, unitPrice: 500 })], [
      { label: "Start", percent: 30 },
      { label: "Halvtid", percent: 40 },
      { label: "Klart", percent: 30 },
    ]);
    const job = createJobFromQuote(quote);
    const basis = closeoutBasis(job.id);
    assert.equal(basis.nextPlanPart?.index, 0);
    assert.ok(basis.modes.some((m) => m.mode === "delfaktura"));
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "delfaktura" });
    assert.equal(draft.type, "delbetalning");
    assert.equal(invoiceTotals(draft).total, 7500);
    assert.equal(draft.paymentPlanIndex, 0);
  });

  it("inget att fakturera eller läget 'ingen' skapar aldrig ett utkast", () => {
    const { job } = kitchenJob();
    const before = db().invoices.length;
    assert.throws(() => createCloseoutInvoiceDraft(job.id, { mode: "ingen" }), (e: unknown) => e instanceof CloseoutError && e.code === "mode");
    assert.throws(() => createCloseoutInvoiceDraft(job.id, { mode: "lopande", includeKeys: [] }), (e: unknown) => e instanceof CloseoutError && e.code === "nothing_to_invoice");
    assert.equal(db().invoices.length, before);
  });

  it("utan offert är allt registrerat fakturerbart", () => {
    const job = createJob({ customerId: "cust-1", title: "Timjobb", description: "" });
    const t = registerJobTime(job.id, { hours: 5, unitPrice: 600 });
    const m = addJobMaterial(job.id, { description: "Skruv", qty: 1, unitPrice: 200 });
    const basis = closeoutBasis(job.id);
    assert.deepEqual(new Set(basis.items.map((i) => i.sourceId)), new Set([t.id, m.id]));
    assert.ok(basis.modes.some((m2) => m2.mode === "lopande" && m2.recommended));
    assert.ok(!basis.modes.some((m2) => m2.mode === "slutfaktura"));
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "lopande" });
    assert.equal(invoiceTotals(draft).total, Math.round(3000 * 1.25) + Math.round(200 * 1.25));
  });

  it("ROT följer med på slutfakturan och avdraget räknas på resten", () => {
    const quote = approvedQuote([labor({ id: "q1", qty: 40, unitPrice: 500 })], PLAN_30_70, "rot");
    const job = createJobFromQuote(quote);
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    assert.equal(draft.rot?.type, "rot");
    const t = invoiceTotals(draft);
    assert.equal(t.total, 25000);
    assert.ok(t.deduction > 0);
    assert.equal(t.toPay, t.total - t.deduction);
  });

  it("avsluta och öppna igen: status, händelser och audit – inget skickas", () => {
    const { job } = kitchenJob();
    const draft = createCloseoutInvoiceDraft(job.id, { mode: "slutfaktura" });
    completeJobCloseout(job.id, { mode: "slutfaktura", invoiceId: draft.id });
    assert.equal(job.status, "klart");
    assert.ok(job.completedAt);
    assert.equal(job.closeout?.billingMode, "slutfaktura");
    assert.ok(job.closeout?.events.some((e) => e.kind === "avslutat" && e.entity?.id === draft.id));
    assert.equal(auditTrail({ action: "uppdrag_avslutat", targetId: job.id }).length, 1);
    assert.equal(draft.status, "utkast");

    reopenJobCloseout(job.id);
    assert.equal(job.status, "pagar");
    assert.equal(job.closeout?.completedAt, undefined);
    assert.ok(job.closeout?.events.some((e) => e.kind === "oppnat_igen"));
    assert.equal(auditTrail({ action: "uppdrag_oppnat_igen", targetId: job.id }).length, 1);
    // Utkastet och besluten ligger kvar.
    assert.equal(existingCloseoutDraft(job.id)?.id, draft.id);
  });
});
