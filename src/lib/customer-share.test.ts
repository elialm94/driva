process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote, createJob } from "./services/jobs";
import { addJobMaterial, registerJobTime } from "./services/job-work";
import { createPartInvoiceForQuote, issueInvoice, registerInvoicePayment } from "./services/invoices";
import { approveJobChange, createJobChange, sendJobChange } from "./services/job-changes";
import {
  customerShareView,
  disableCustomerShare,
  enableCustomerShare,
  getJobByShareToken,
  ownerCloseoutSummaryView,
} from "./services/customer-share";
import { auditTrail } from "./accounting/audit";
import type { PaymentPlanPart } from "./types";

const PLAN: PaymentPlanPart[] = [
  { label: "Vid start", percent: 30, kind: "forskott" },
  { label: "När arbetet är klart", percent: 70, kind: "slutbetalning" },
];

function setup() {
  replaceDb(emptyTestDb({ customers: [testCustomer({ id: "cust-1", name: "Anna Andersson" })] }));
  const quote = createQuote({
    customerId: "cust-1",
    title: "Kök",
    lines: [labor({ id: "q1", qty: 40, unitPrice: 500 })],
    rot: null,
    paymentPlan: PLAN,
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  quote.decidedAt = "2026-08-01T10:00:00.000Z";
  const job = createJobFromQuote(quote);
  job.notes = "INTERN: kunden är krånglig, marginal 38 %";
  job.photos = [
    { id: "p1", createdAt: "2026-08-03T10:00:00.000Z", dataUrl: "data:image/png;base64,AAA", caption: "Före" },
    { id: "p2", createdAt: "2026-08-09T10:00:00.000Z", dataUrl: "data:image/png;base64,BBB", caption: "Efter" },
  ];
  const material = addJobMaterial(job.id, { description: "Ekskiva", qty: 1, unitPrice: 4000 });
  material.wholesaler = { connectionId: "c", purchaseOrderId: "po", purchaseOrderLineId: "l", unitCostOre: 250000 };
  registerJobTime(job.id, { hours: 8, description: "Montering" });
  const part = createPartInvoiceForQuote(quote.id, 0);
  issueInvoice(part.id);
  registerInvoicePayment(part.id, { amount: 7500, matchedBy: "manuell" });
  const change = sendJobChange(
    createJobChange(job.id, { title: "Flyttat eluttag", description: "", lines: [labor({ id: "c1", qty: 2, unitPrice: 1000 })] }).id
  );
  approveJobChange({ token: change.token, name: "Anna" });
  const pendingChange = sendJobChange(
    createJobChange(job.id, { title: "Extra hylla", description: "", lines: [labor({ id: "c2", qty: 1, unitPrice: 800 })] }).id
  );
  return { quote, job, part, change, pendingChange };
}

describe("Kundvyn: bara det som uttryckligen delats", () => {
  beforeEach(() => setup());

  it("ingen länk = ingen vy; länken skapas med säkra standardval och loggas", () => {
    const { job } = setup();
    assert.equal(customerShareView(job), undefined);
    assert.equal(getJobByShareToken(""), undefined);

    const share = enableCustomerShare(job.id);
    assert.ok(share.token.length >= 20);
    assert.equal(share.closeoutSummary, false, "slutunderlaget delas aldrig automatiskt");
    assert.deepEqual(share.photoIds, [], "inga foton delas automatiskt");
    assert.equal(getJobByShareToken(share.token)?.id, job.id);
    assert.ok((job.closeout?.events ?? []).some((e) => e.kind === "kundvy_delad"));
  });

  it("vyn innehåller godkänd offert, godkända ändringar, fakturor och betalstatus – aldrig internt", () => {
    const { job, change, pendingChange } = setup();
    enableCustomerShare(job.id, { photoIds: ["p2"] });
    const view = customerShareView(job)!;
    assert.equal(view.quote?.number, 1);
    assert.equal(view.quote?.toPay, 25000);
    assert.equal(view.changes.length, 1, "bara godkända ändringar");
    assert.equal(view.changes[0].id, change.id);
    assert.ok(!view.changes.some((c) => c.id === pendingChange.id));
    assert.equal(view.photos.length, 1);
    assert.equal(view.photos[0].id, "p2");
    assert.equal(view.invoices.length, 1);
    assert.equal(view.invoices[0].status, "betald");
    assert.equal(view.paymentStatus?.invoiced, 7500);
    assert.equal(view.paymentStatus?.paid, 7500);
    assert.equal(view.paymentStatus?.remaining, 0);
    assert.deepEqual(view.paymentStatus?.upcoming, [{ label: "När arbetet är klart", amount: 17500 }]);
    assert.equal(view.work, undefined, "utfört arbete följer bara med slutunderlaget");

    // Inget internt får finnas i det som serialiseras till kundens sida.
    const json = JSON.stringify(view);
    assert.ok(!json.includes("INTERN"), "interna anteckningar");
    assert.ok(!json.includes("marginal"), "marginal");
    assert.ok(!json.includes("unitCostOre") && !json.includes("250000"), "inköpspris");
    assert.ok(!json.includes("wholesaler"), "grossist");
    assert.ok(!json.includes("notes"), "anteckningsfält");
  });

  it("avbockat = borta; slutunderlaget visar arbete utan priser; stängd länk ger ingen vy", () => {
    const { job } = setup();
    enableCustomerShare(job.id, { quote: false, invoices: false, paymentStatus: false, changes: false });
    let view = customerShareView(job)!;
    assert.equal(view.quote, undefined);
    assert.equal(view.invoices.length, 0);
    assert.equal(view.paymentStatus, undefined);
    assert.equal(view.changes.length, 0);

    enableCustomerShare(job.id, { closeoutSummary: true });
    view = customerShareView(job)!;
    assert.equal(view.closeoutSummary, true);
    assert.equal(view.work?.hours, 8);
    assert.deepEqual(view.work?.descriptions, ["Montering"]);
    assert.ok(!JSON.stringify(view.work).includes("4000"), "materialpris läcker inte via arbetet");
    assert.ok((job.closeout?.events ?? []).some((e) => e.kind === "slutunderlag_skapat"));

    const token = job.customerShare!.token;
    disableCustomerShare(job.id);
    assert.equal(customerShareView(job), undefined);
    assert.equal(getJobByShareToken(token)?.id, job.id, "token finns kvar men sidan svarar stängd");
    assert.ok(auditTrail().some((e) => e.action === "uppdrag_kundvy_stangd"));
    assert.ok((job.closeout?.events ?? []).some((e) => e.kind === "kundvy_stangd"));

    // Öppna igen: samma token, inställningarna kvar.
    const again = enableCustomerShare(job.id);
    assert.equal(again.token, token);
    assert.equal(again.closeoutSummary, true);
    assert.equal(again.quote, false);
  });

  it("ägarens förhandsgranskning har allt men samma fotoval; jobb utan offert fungerar", () => {
    const { job } = setup();
    enableCustomerShare(job.id, { quote: false, photoIds: ["p1"] });
    const owner = ownerCloseoutSummaryView(job);
    assert.ok(owner.quote, "ägaren ser offerten i förhandsgranskningen");
    assert.equal(owner.photos.length, 1);
    assert.equal(owner.work?.hours, 8);

    const plain = createJob({ customerId: "cust-1", title: "Löpande småjobb", description: "" });
    const share = enableCustomerShare(plain.id, { closeoutSummary: true });
    const view = customerShareView(plain)!;
    assert.equal(view.token, share.token);
    assert.equal(view.quote, undefined);
    assert.equal(view.paymentStatus?.upcoming.length, 0);
    assert.equal(db().jobs.filter((j) => j.customerShare).length, 2);
  });
});
