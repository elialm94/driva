process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote } from "./services/quotes";
import { createJobFromQuote } from "./services/jobs";
import { createInvoice, issueInvoice } from "./services/invoices";
import {
  JobChangeError,
  approveJobChange,
  changeLineToDocLine,
  createJobChange,
  createJobChangeVersion,
  declineJobChange,
  deleteJobChange,
  jobChangeDisplayStatus,
  jobChangeHash,
  jobChangesForJob,
  sendJobChange,
  updateJobChange,
} from "./services/job-changes";
import { __resetQuoteAcceptRateLimitForTests } from "./services/quote-accept";
import { auditTrail } from "./accounting/audit";
import { kr } from "./format";
import type { DocLine } from "./types";

function reset() {
  __resetQuoteAcceptRateLimitForTests();
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1", name: "Anna Andersson", email: "anna@example.com" })],
    })
  );
}

function jobWithQuote() {
  const quote = createQuote({
    customerId: "cust-1",
    title: "Kök",
    lines: [labor({ id: "q1", qty: 10, unitPrice: 500 })],
    rot: null,
    paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
  quote.status = "godkand";
  return createJobFromQuote(quote);
}

const extra = (over: Partial<DocLine> = {}): DocLine =>
  labor({ id: "c-1", description: "Extra eluttag", qty: 2, unitPrice: 1000, ...over });

describe("Ändringar och tillägg med kundgodkännande", () => {
  beforeEach(() => reset());

  it("skapar utkast med löpnummer, låser vid utskick och sparar hash + snapshots", () => {
    const job = jobWithQuote();
    const c1 = createJobChange(job.id, { title: "Extra eluttag", description: "Två uttag till", lines: [extra()] });
    const c2 = createJobChange(job.id, { title: "Byte av list", description: "", lines: [extra({ id: "c-2" })] });
    assert.equal(c1.number, 1);
    assert.equal(c2.number, 2);
    assert.equal(c1.status, "utkast");
    assert.ok(c1.token.length > 10);

    const sent = sendJobChange(c1.id);
    assert.equal(sent.status, "vantar_pa_kunden");
    assert.ok(sent.lockedAt);
    assert.equal(sent.contentHash, jobChangeHash(sent));
    assert.ok(sent.sellerSnapshot);
    assert.equal(sent.buyerSnapshot?.name, "Anna Andersson");
    assert.throws(() => updateJobChange(c1.id, { title: "Nytt" }), (e: unknown) => e instanceof JobChangeError && e.code === "locked");
    assert.throws(() => deleteJobChange(c1.id), JobChangeError);
  });

  it("vägrar skicka utan rader", () => {
    const job = jobWithQuote();
    const c = createJobChange(job.id, { title: "Tom", description: "", lines: [] });
    assert.throws(() => sendJobChange(c.id), (e: unknown) => e instanceof JobChangeError && e.code === "lines_empty");
  });

  it("kunden godkänner via token: namn krävs, hashen måste stämma, beviset sparas, audit loggas", () => {
    const job = jobWithQuote();
    const c = sendJobChange(createJobChange(job.id, { title: "Extra eluttag", description: "", lines: [extra()] }).id);

    assert.throws(() => approveJobChange({ token: c.token, name: "  " }), (e: unknown) => e instanceof JobChangeError && e.code === "name_required");
    assert.throws(
      () => approveJobChange({ token: c.token, name: "Anna", expectedContentHash: "fel" }),
      (e: unknown) => e instanceof JobChangeError && e.code === "changed"
    );
    assert.throws(() => approveJobChange({ token: "finns-inte", name: "Anna" }), (e: unknown) => e instanceof JobChangeError && e.code === "not_found");

    const r = approveJobChange({ token: c.token, name: " Anna  Andersson ", expectedContentHash: c.contentHash, ip: "10.0.0.1", userAgent: "Test" });
    assert.equal(r.outcome, "approved");
    assert.equal(r.change.status, "godkand");
    assert.equal(r.approval.approvedByName, "Anna Andersson");
    assert.equal(r.approval.contentHash, c.contentHash);
    assert.match(r.approval.statement, /Extra eluttag/);
    assert.ok(r.approval.statement.includes(kr(2500)));
    assert.equal(r.approval.ip, "10.0.0.1");

    // Idempotent: andra tryck ger samma bevis.
    const again = approveJobChange({ token: c.token, name: "Någon Annan" });
    assert.equal(again.outcome, "already_approved");
    assert.equal(again.approval.approvedByName, "Anna Andersson");

    assert.equal(auditTrail({ action: "andring_godkand", targetId: c.id }).length, 1);
    assert.ok(db().activity.some((a) => a.entity?.type === "andring" && a.entity.id === c.id));
  });

  it("utkast är inte publika och avböjd ändring kan inte godkännas", () => {
    const job = jobWithQuote();
    const draft = createJobChange(job.id, { title: "Utkast", description: "", lines: [extra()] });
    assert.throws(() => approveJobChange({ token: draft.token, name: "Anna" }), (e: unknown) => e instanceof JobChangeError && e.code === "not_found");

    const sent = sendJobChange(createJobChange(job.id, { title: "Avböjs", description: "", lines: [extra({ id: "c-9" })] }).id);
    const declined = declineJobChange(sent.token, "För dyrt");
    assert.equal(declined?.status, "avbojd");
    assert.equal(declined?.declineReason, "För dyrt");
    assert.throws(() => approveJobChange({ token: sent.token, name: "Anna" }), (e: unknown) => e instanceof JobChangeError && e.code === "declined");
    assert.equal(auditTrail({ action: "andring_avbojd", targetId: sent.id }).length, 1);
  });

  it("ny version ersätter den gamla först när den skickas; den gamla behåller sitt innehåll", () => {
    const job = jobWithQuote();
    const v1 = sendJobChange(createJobChange(job.id, { title: "Extra eluttag", description: "", lines: [extra()] }).id);
    const v2 = createJobChangeVersion(v1.id);
    assert.equal(v2.number, 1);
    assert.equal(v2.version, 2);
    assert.equal(v2.status, "utkast");
    assert.equal(v2.replacesChangeId, v1.id);
    assert.equal(v1.status, "vantar_pa_kunden");
    // Samma anrop igen ger samma utkast – inte två.
    assert.equal(createJobChangeVersion(v1.id).id, v2.id);

    updateJobChange(v2.id, { lines: [extra({ id: "c-2", unitPrice: 800 })] });
    sendJobChange(v2.id);
    assert.equal(v1.status, "ersatt");
    assert.equal(v1.replacedByChangeId, v2.id);
    assert.equal(v1.lines[0].unitPrice, 1000);
    assert.throws(() => approveJobChange({ token: v1.token, name: "Anna" }), (e: unknown) => e instanceof JobChangeError && e.code === "not_approvable");
    assert.equal(jobChangesForJob(job.id).length, 2);
  });

  it("kastat utkast till ny version lämnar den gamla gällande", () => {
    const job = jobWithQuote();
    const v1 = sendJobChange(createJobChange(job.id, { title: "A", description: "", lines: [extra()] }).id);
    const v2 = createJobChangeVersion(v1.id);
    deleteJobChange(v2.id);
    assert.equal(v1.replacedByChangeId, undefined);
    assert.equal(jobChangesForJob(job.id).length, 1);
  });

  it("Delvis fakturerad / Fakturerad härleds ur allokeringen, aldrig lagrat", () => {
    const job = jobWithQuote();
    const c = sendJobChange(
      createJobChange(job.id, {
        title: "Två tillägg",
        description: "",
        lines: [extra({ id: "c-a", description: "Uttag" }), extra({ id: "c-b", description: "List" })],
      }).id
    );
    approveJobChange({ token: c.token, name: "Anna" });
    assert.equal(jobChangeDisplayStatus(c), "godkand");

    const inv = createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      type: "faktura",
      lines: [changeLineToDocLine(c, c.lines[0])],
      rot: null,
      strictAllocation: true,
    });
    assert.equal(jobChangeDisplayStatus(c), "delvis_fakturerad");
    issueInvoice(inv.id);
    assert.equal(jobChangeDisplayStatus(c), "delvis_fakturerad");

    createInvoice({ customerId: "cust-1", jobId: job.id, type: "faktura", lines: [changeLineToDocLine(c, c.lines[1])], rot: null, strictAllocation: true });
    assert.equal(jobChangeDisplayStatus(c), "fakturerad");
    assert.throws(() => createJobChangeVersion(c.id), (e: unknown) => e instanceof JobChangeError && e.code === "billed");
  });

  it("samma ändringsrad kan inte faktureras två gånger i strikt läge", () => {
    const job = jobWithQuote();
    const c = sendJobChange(createJobChange(job.id, { title: "A", description: "", lines: [extra()] }).id);
    approveJobChange({ token: c.token, name: "Anna" });
    createInvoice({ customerId: "cust-1", jobId: job.id, type: "faktura", lines: [changeLineToDocLine(c, c.lines[0])], rot: null, strictAllocation: true });
    assert.throws(() =>
      createInvoice({ customerId: "cust-1", jobId: job.id, type: "faktura", lines: [changeLineToDocLine(c, c.lines[0])], rot: null, strictAllocation: true })
    );
    assert.equal(db().invoices.length, 1);
  });

  it("rad utan enhet får 'st' så att fakturaraden alltid går ner i databasen (unit not null)", () => {
    const job = jobWithQuote();
    const c = createJobChange(job.id, {
      title: "Utan enhet",
      description: "",
      lines: [{ id: "u1", kind: "arbete", description: "Handledare", qty: 4, unitPrice: 600, vatRate: 25 } as DocLine, extra({ unit: " tim " })],
    });
    assert.equal(c.lines[0].unit, "st");
    assert.equal(c.lines[1].unit, "tim");
  });
});
