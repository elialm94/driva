process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createQuote, quoteSendBlockers, updateQuote } from "./services/quotes";
import { currentVersion } from "./services/data";
import { quoteMissingRequirements } from "./form-requirements";
import { DEFAULT_PAYMENT_PLAN, hasPaymentPlan, normalizePaymentPlan, paymentPlanAmounts, paymentPlanIssue, paymentPlanPartKind } from "./payment-plan";
import type { PaymentPlanPart } from "./types";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer({ id: "cust-1", name: "Test Testsson", email: "test@example.com" })],
    })
  );
}

function quoteWithPlan(plan: PaymentPlanPart[]) {
  return createQuote({
    customerId: "cust-1",
    title: "Altan",
    lines: [labor({ id: "q1", qty: 40, unitPrice: 500 })], // 20 000 exkl, 25 000 inkl
    rot: null,
    paymentPlan: plan,
    paymentTermsDays: 30,
    validUntil: "2030-01-01",
    terms: "",
  });
}

describe("Betalplan: förskott, delbetalning och slutbetalning", () => {
  beforeEach(() => reset());

  it("standard är ingen betalplan – allt när arbetet är klart", () => {
    assert.equal(hasPaymentPlan(DEFAULT_PAYMENT_PLAN), false);
    assert.equal(paymentPlanPartKind(DEFAULT_PAYMENT_PLAN, 0), "slutbetalning");
    assert.deepEqual(paymentPlanAmounts(DEFAULT_PAYMENT_PLAN, 25000), [25000]);
    assert.equal(paymentPlanIssue(DEFAULT_PAYMENT_PLAN, 25000), null);
  });

  it("förskott i kronor + delbetalning i procent + rest: summan blir exakt offerten", () => {
    const plan: PaymentPlanPart[] = [
      { label: "Förskott", percent: 0, amount: 5000, kind: "forskott" },
      { label: "Halvtid", percent: 33 },
      { label: "Klart", percent: 100 },
    ];
    assert.equal(paymentPlanIssue(plan, 25000), null);
    const amounts = paymentPlanAmounts(plan, 25000);
    assert.deepEqual(amounts, [5000, 8250, 11750]);
    assert.equal(amounts.reduce((s, a) => s + a, 0), 25000);
    assert.equal(paymentPlanPartKind(plan, 1), "delbetalning");
    assert.equal(paymentPlanPartKind(plan, 2), "slutbetalning");
  });

  it("stoppar planer som inte går ihop", () => {
    assert.match(paymentPlanIssue([{ label: "A", percent: 30 }, { label: "B", percent: 60 }])!, /100 %/);
    assert.match(paymentPlanIssue([{ label: "Förskott", percent: 0, amount: 30000 }, { label: "Rest", percent: 100 }], 25000)!, /överstiga/);
    assert.match(paymentPlanIssue([{ label: "A", percent: 50 }, { label: "Rest", percent: 100, amount: 5000 }], 25000)!, /Sista delen/);
    assert.match(paymentPlanIssue([{ label: "", percent: 100 }])!, /namn/);
  });

  it("formuläret använder den fullständiga valideringen när den ges", () => {
    const base = {
      customerId: "cust-1",
      title: "Altan",
      lines: [labor({ id: "q1", qty: 1, unitPrice: 100 })],
      planPercentTotal: 0,
      validUntil: "2030-01-01",
      paymentTermsDays: 30,
    };
    // Fast förskott: procentsumman är inte 100 men planen är giltig.
    assert.equal(quoteMissingRequirements({ ...base, paymentPlanIssue: null }).some((m) => m.id === "betalplan"), false);
    const missing = quoteMissingRequirements({ ...base, paymentPlanIssue: "Delarna blir mer än 100 % av offerten." });
    assert.equal(missing.filter((m) => m.id === "betalplan").length, 1);
    assert.match(missing.find((m) => m.id === "betalplan")!.label, /Betalplan/);
  });

  it("offerten normaliserar planen vid sparande och blockerar utskick av felaktig plan", () => {
    const quote = quoteWithPlan([
      { label: "  Förskott ", percent: 0, amount: 5000.4, kind: "forskott" },
      { label: "Klart", percent: 100 },
    ]);
    const version = currentVersion(quote);
    assert.equal(version.paymentPlan[0].label, "Förskott");
    assert.equal(version.paymentPlan[0].amount, 5000);
    assert.equal(quoteSendBlockers(quote.id).some((b) => b.code === "payment_plan"), false);

    updateQuote(quote.id, {
      title: version.title,
      lines: version.lines,
      rot: null,
      paymentPlan: [{ label: "Förskott", percent: 0, amount: 90000 }, { label: "Klart", percent: 100 }],
      paymentTermsDays: 30,
      validUntil: version.validUntil,
      terms: "",
    });
    const blocker = quoteSendBlockers(quote.id).find((b) => b.code === "payment_plan");
    assert.ok(blocker);
    assert.match(blocker.message, /överstiga/);
  });

  it("tom plan (äldre data) lämnas tom och blockerar inte", () => {
    const quote = quoteWithPlan([]);
    assert.deepEqual(currentVersion(quote).paymentPlan, []);
    assert.equal(quoteSendBlockers(quote.id).some((b) => b.code === "payment_plan"), false);
  });

  it("normalizePaymentPlan städar rått formulärdata", () => {
    const plan = normalizePaymentPlan([
      { label: " Start ", percent: "30", kind: "forskott" },
      { label: "Klart", percent: 70, amount: "" },
      null,
    ]);
    assert.deepEqual(plan, [
      { label: "Start", percent: 30, kind: "forskott" },
      { label: "Klart", percent: 70 },
    ]);
    assert.deepEqual(normalizePaymentPlan("nonsens"), DEFAULT_PAYMENT_PLAN);
  });
});
