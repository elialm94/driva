process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "../store";
import { emptyTestDb, labor } from "./test-db";
import {
  createInvoice,
  creditInvoice,
  issueInvoice,
  markInvoicePaid,
  sendReminder,
} from "../services/invoices";
import { createQuote } from "../services/quotes";
import { createJobFromQuote } from "../services/jobs";
import { customerSummary, getInvoice, isOpenReceivable, isOverdue } from "../services/data";
import { jobMoneySummary, remainingToInvoiceForJob } from "../services/attention";
import { getBusinessActions } from "../services/actions";
import { businessStats } from "../services/finance";
import { matchIncomingTransaction } from "../services/banking";
import type { BankAccount, BankTransaction } from "../types";

function reset() {
  replaceDb(emptyTestDb());
}

function issuedInvoice(unitPrice = 2000) {
  const inv = createInvoice({
    customerId: "cust-1",
    type: "faktura",
    lines: [labor({ unitPrice })],
    rot: null,
  });
  return issueInvoice(inv.id);
}

describe("Kreditfakturor är inte fordringar", () => {
  beforeEach(() => reset());

  it("krediterad faktura nollar utestående för kunden och Hem/Ekonomi", () => {
    const issued = issuedInvoice();
    assert.equal(customerSummary("cust-1").unpaid, 2500);
    creditInvoice(issued.id);
    assert.equal(customerSummary("cust-1").unpaid, 0);
    const actions = getBusinessActions();
    assert.ok(!actions.attention.some((a) => a.category === "invoice"));
    assert.ok(!actions.watching.some((o) => o.category === "invoice"));
    assert.equal(businessStats().unpaidCount, 0);
    assert.equal(businessStats().unpaidSum, 0);
  });

  it("en kreditfaktura blir aldrig försenad eller påmind", () => {
    const issued = issuedInvoice();
    const credit = creditInvoice(issued.id);
    credit.dueDate = "2020-01-01T12:00:00.000Z";
    assert.equal(isOpenReceivable(credit), false);
    assert.equal(isOverdue(credit), false);
    assert.ok(!getBusinessActions().attention.some((a) => a.id.startsWith("invoice-late-")));
    sendReminder(credit.id);
    assert.equal(getInvoice(credit.id)!.reminders.length, 0);
  });

  it("kreditfaktura kan inte markeras som betald", () => {
    const issued = issuedInvoice();
    const credit = creditInvoice(issued.id);
    assert.throws(() => markInvoicePaid(credit.id, { matchedBy: "manuell" }), /kreditfaktura/i);
    assert.notEqual(getInvoice(credit.id)!.status, "betald");
  });

  it("bankmatchning matchar aldrig en kreditfaktura på belopp", () => {
    const issued = issuedInvoice();
    const credit = creditInvoice(issued.id);
    const account: BankAccount = {
      id: "acc-1",
      provider: "mock",
      name: "Företagskonto",
      accountNumber: "1234-5678",
      balance: 0,
      connectedAt: new Date().toISOString(),
    };
    const tx: BankTransaction = {
      id: "tx-1",
      accountId: account.id,
      date: new Date().toISOString(),
      amount: 2500, // exakt kreditens toPay
      counterpart: "Anna Andersson",
      description: "Inbetalning",
      status: "ny",
    };
    db().bankAccounts.push(account);
    db().bankTransactions.push(tx);
    const matched = matchIncomingTransaction(tx.id);
    assert.equal(matched, false);
    assert.equal(tx.status, "behover_atgard");
    assert.notEqual(getInvoice(credit.id)!.status, "betald");
    assert.equal(db().payments.length, 0);
  });

  it("kreditering frigör beloppet att fakturera igen på uppdraget", () => {
    const quote = createQuote({
      customerId: "cust-1",
      title: "Altan",
      intro: "",
      lines: [labor({ unitPrice: 10_000 })],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: "2030-01-01",
      terms: "",
    });
    quote.status = "godkand";
    const job = createJobFromQuote(quote);
    const total = 12_500; // 10 000 + 25 % moms

    assert.equal(remainingToInvoiceForJob(job.id), total);

    const inv = createInvoice({
      customerId: "cust-1",
      jobId: job.id,
      quoteId: quote.id,
      type: "faktura",
      lines: [labor({ unitPrice: 10_000 })],
      rot: null,
    });
    issueInvoice(inv.id);
    assert.equal(remainingToInvoiceForJob(job.id), 0);
    assert.equal(jobMoneySummary(job.id).invoiced, total);

    creditInvoice(inv.id);
    assert.equal(remainingToInvoiceForJob(job.id), total);
    assert.equal(jobMoneySummary(job.id).invoiced, 0);
    assert.equal(jobMoneySummary(job.id).paid, 0);
  });
});
