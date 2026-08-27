process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, labor } from "./invoices/test-db";
import {
  attentionItems,
  ATTENTION_PRIORITY,
  homeNextSteps,
  remainingToInvoiceForJob,
} from "./services/attention";
import { createJob, setJobStatus } from "./services/jobs";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice, createNextInvoiceForJob, issueInvoice, markInvoicePaid } from "./services/invoices";
import { getJob } from "./services/data";

function reset() {
  replaceDb(buildSeed());
}

function approveQuote(opts: {
  jobId: string;
  title: string;
  paymentPlan: { label: string; percent: number }[];
  rot?: "rot";
}) {
  const job = getJob(opts.jobId)!;
  const defaults = quoteDefaults();
  const quote = createQuote({
    customerId: job.customerId,
    jobId: job.id,
    title: opts.title,
    intro: opts.title,
    lines: [labor({ unitPrice: 10_000 })],
    rot: opts.rot ? { type: "rot" } : null,
    paymentPlan: opts.paymentPlan,
    paymentTermsDays: defaults.paymentTermsDays,
    validUntil: defaults.validUntil,
    terms: defaults.terms,
  });
  quote.status = "godkand";
  return quote;
}

describe("attention ranking", () => {
  it("sorterar försenad faktura före förfrågan, kvitto sist", () => {
    reset();
    const kinds = attentionItems().map((i) => i.kind);
    assert.ok(kinds.length > 0);
    for (let i = 1; i < kinds.length; i++) {
      assert.ok(
        ATTENTION_PRIORITY[kinds[i - 1]] <= ATTENTION_PRIORITY[kinds[i]],
        `${kinds[i - 1]} ska komma före eller lika med ${kinds[i]}`
      );
    }
    assert.equal(kinds[0], "forsenad_faktura");
    const inquiry = kinds.indexOf("forfragan");
    const receipt = kinds.indexOf("kvitto_saknas");
    const question = kinds.indexOf("bokforingsfraga");
    assert.ok(question >= 0 && question < inquiry);
    assert.ok(inquiry >= 0 && inquiry < receipt);
  });

  it("innehåller inte fakturera-jobb – det är nästa steg", () => {
    reset();
    assert.ok(!attentionItems().some((i) => (i as { kind: string }).kind === "fakturera_jobb"));
  });

  it("tom databas ger tom lista", () => {
    replaceDb(emptyTestDb());
    assert.deepEqual(attentionItems(), []);
  });
});

describe("homeNextSteps", () => {
  it("föreslår första fakturan efter BankID utan att uppdraget startats", () => {
    replaceDb(emptyTestDb());
    const job = createJob({ customerId: "cust-1", title: "Kök", startDate: "2027-09-01" });
    approveQuote({
      jobId: job.id,
      title: "Kök",
      paymentPlan: [
        { label: "Vid arbetets start", percent: 30 },
        { label: "När arbetet är klart och godkänt", percent: 70 },
      ],
    });
    const steps = homeNextSteps();
    assert.equal(steps.length, 1);
    assert.equal(steps[0].kind, "forsta_faktura");
    if (steps[0].kind === "forsta_faktura") {
      assert.equal(steps[0].percent, 30);
      assert.ok(steps[0].amount > 0);
    }
  });

  it("föreslår faktura när godkänd offert inte fakturerats, även utan delplan", () => {
    replaceDb(emptyTestDb());
    const job = createJob({ customerId: "cust-1", title: "Hylla" });
    approveQuote({
      jobId: job.id,
      title: "Hylla",
      paymentPlan: [{ label: "Betalning när arbetet är klart", percent: 100 }],
    });
    const steps = homeNextSteps();
    assert.equal(steps.length, 1);
    assert.equal(steps[0].kind, "kan_fakturera");
  });

  it("föreslår resterande/slutfaktura när del redan fakturerats – inte att jobbet pågår", () => {
    replaceDb(emptyTestDb());
    const job = createJob({ customerId: "cust-1", title: "Altan", startDate: "2026-08-01" });
    approveQuote({
      jobId: job.id,
      title: "Altan",
      paymentPlan: [
        { label: "Vid arbetets start", percent: 50 },
        { label: "När arbetet är klart och godkänt", percent: 50 },
      ],
    });
    createNextInvoiceForJob(job.id);
    const steps = homeNextSteps();
    assert.equal(steps.length, 1);
    assert.equal(steps[0].kind, "resterande");
    if (steps[0].kind === "resterande") {
      assert.equal(steps[0].isFinal, true);
      assert.ok(steps[0].amount > 0);
    }
    assert.ok(remainingToInvoiceForJob(job.id) > 0);
  });

  it("döljer sektionen när inget administrativt återstår", () => {
    replaceDb(emptyTestDb());
    createJob({ customerId: "cust-1", title: "Pågående utan offert" });
    assert.deepEqual(homeNextSteps(), []);
  });

  it("seed visar bara faktura-admin, inte att köket pågår", () => {
    reset();
    const steps = homeNextSteps();
    assert.ok(steps.every((s) => s.kind !== "kan_fakturera" || s.job.title !== "Köksrenovering"));
    const kok = steps.find((s) => s.job.title === "Köksrenovering");
    assert.ok(kok);
    assert.equal(kok.kind, "resterande");
  });

  it("ROT redo att ansökas när kunden betalat och arbetet är klart", () => {
    reset();
    const job = getJob("job-kok")!;
    job.housing = { dwellingType: "smahus", propertyDesignation: "Södermalm 12:34" };
    const inv = createInvoice({
      customerId: "cust-anna",
      jobId: "job-kok",
      type: "faktura",
      lines: [labor({ unitPrice: 8_000 })],
      rot: { type: "rot" },
    });
    issueInvoice(inv.id);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    setJobStatus("job-kok", "klart");
    const steps = homeNextSteps();
    assert.ok(steps.some((s) => s.kind === "rot_ansok" && s.job.id === "job-kok"));
  });
});
