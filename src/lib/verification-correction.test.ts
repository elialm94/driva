process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { createInvoice, creditInvoice, issueInvoice, markInvoicePaid } from "./services/invoices";
import { answerExpenseQuestion } from "./services/expenses";
import { receiveSupplierInvoice } from "./services/suppliers";
import { PostingError, verificationLabel } from "./accounting/engine";
import { accountBalance } from "./accounting/ledger";
import { lockPeriod } from "./accounting/fiscal";
import { bokforingsdatum } from "./accounting/dates";
import { executeTool, toolRequiresConfirmation, toolRisk } from "./ai/tools";
import { confirmPendingAction } from "./services/assistant";
import {
  inspectCorrectionFlow,
  postVerificationCorrection,
  previewCorrection,
  isPaymentLive,
} from "./services/verification-correction";
import { verificationOverflowItems } from "./services/verification-overflow";
import type { BankAccount, Expense } from "./types";

const THIS_YEAR = Number(new Date().toISOString().slice(0, 4));

function bankAccount(balance = 100_000): BankAccount {
  return {
    id: "bank-1",
    provider: "mock",
    name: "Företagskonto",
    accountNumber: "1234-5678",
    balance,
    connectedAt: new Date().toISOString(),
  };
}

function reset(over: Parameters<typeof emptyTestDb>[0] = {}) {
  replaceDb(emptyTestDb({ bankAccounts: [bankAccount()], ...over }));
}

function unansweredExpense(over: Partial<Expense> = {}): Expense {
  const expense: Expense = {
    id: over.id ?? "exp-1",
    supplier: over.supplier ?? "Bauhaus",
    date: over.date ?? new Date().toISOString(),
    amount: over.amount ?? 1250,
    vatAmount: over.vatAmount ?? 250,
    description: over.description,
    category: over.category,
    status: "behover_svar",
    question: { text: "Vad gällde köpet?", options: ["Material", "Annat"] },
    createdAt: new Date().toISOString(),
    ...over,
  };
  db().expenses.push(expense);
  return expense;
}

function autoBookedExpense(over: Partial<Expense> = {}): Expense {
  const expense = unansweredExpense({ supplier: "Trygg-Hansa", ...over });
  answerExpenseQuestion(expense.id, "Försäkring");
  return expense;
}

function balanced(entries: { debit: number; credit: number }[]): boolean {
  return entries.reduce((s, e) => s + e.debit - e.credit, 0) === 0 && entries.some((e) => e.debit > 0);
}

describe("Rätta bokföring – utgift", () => {
  beforeEach(() => reset());

  it("auto-bokad utgift rättas till annat konto: original orört, rättelse balanserad", () => {
    const expense = autoBookedExpense();
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    const before = JSON.stringify(original.entries);
    assert.equal(original.createdBy, "anvandare");
    assert.ok(original.entries.some((e) => e.account === 6310));

    const posted = postVerificationCorrection(original.id, { kind: "konto", category: "material", reason: "Fel kostnadskonto" });

    const still = db().verifications.find((v) => v.id === original.id)!;
    assert.equal(JSON.stringify(still.entries), before);
    assert.equal(still.correctedByVerificationId, posted.reversal.id);
    assert.equal(posted.reversal.correctsVerificationId, original.id);
    assert.ok(posted.replacement);
    assert.ok(balanced(posted.reversal.entries));
    assert.ok(balanced(posted.replacement!.entries));
    assert.equal(posted.replacement!.entries.find((e) => e.account === 4010)?.debit, 1000);
    assert.equal(posted.replacement!.entries.find((e) => e.account === 2641)?.debit, 250);
    assert.equal(accountBalance(6310), 0);
    assert.equal(accountBalance(4010), 1000);
    assert.equal(expense.category, "material");
    assert.equal(expense.status, "bokford");
    assert.equal(expense.verificationId, posted.replacement!.id);
    assert.equal(expense.question, undefined);
  });

  it("moms-känslig rättelse: försäkring (momsfri) → material (moms)", () => {
    const expense = unansweredExpense({
      supplier: "Trygg-Hansa",
      amount: 1000,
      vatAmount: 200,
    });
    answerExpenseQuestion(expense.id, "Försäkring");
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    assert.equal(original.entries.some((e) => e.account === 2641), false);
    assert.equal(original.entries.find((e) => e.account === 6310)!.debit, 1000);

    const preview = previewCorrection(original.id, { kind: "konto", category: "material" });
    assert.ok(preview.warning);
    const posted = postVerificationCorrection(original.id, { kind: "konto", category: "material" });
    assert.equal(posted.replacement!.entries.find((e) => e.account === 2641)?.debit, 200);
    assert.equal(posted.replacement!.entries.find((e) => e.account === 4010)?.debit, 800);
    assert.ok(balanced(posted.replacement!.entries));
  });

  it("låst period: rättelsen landar på första öppna dag, original orört", () => {
    const expense = autoBookedExpense();
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    const before = JSON.stringify(original.entries);
    lockPeriod(bokforingsdatum(new Date().toISOString()), "anvandare");

    const posted = postVerificationCorrection(original.id, { kind: "konto", category: "verktyg" });
    const lock = db().accounting.lockedThrough!;
    assert.ok(bokforingsdatum(posted.reversal.date) > lock);
    assert.equal(JSON.stringify(db().verifications.find((v) => v.id === original.id)!.entries), before);
    const flow = inspectCorrectionFlow(original.id);
    assert.equal(flow.kind, "redan_rattad");
  });

  it("redan rättad verifikation avvisas vid annan avsikt", () => {
    const expense = autoBookedExpense();
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    postVerificationCorrection(original.id, { kind: "konto", category: "material" });
    assert.throws(
      () => postVerificationCorrection(original.id, { kind: "konto", category: "verktyg" }),
      (e: unknown) => e instanceof PostingError && e.code === "redan_rattad"
    );
  });

  it("dubbelklick är idempotent – en rättelse, samma id", () => {
    const expense = autoBookedExpense();
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    const first = postVerificationCorrection(original.id, { kind: "konto", category: "material" });
    const second = postVerificationCorrection(original.id, { kind: "konto", category: "material" });
    assert.equal(second.reversal.id, first.reversal.id);
    assert.equal(second.replacement?.id, first.replacement?.id);
    assert.equal(second.idempotent, true);
    assert.equal(db().verifications.filter((v) => v.source.type === "rattelse").length, 2);
  });
});

describe("Rätta bokföring – leverantörsfaktura", () => {
  beforeEach(() => reset());

  it("byter kostnadskonto och lämnar 2440 åt motorn", () => {
    const sup = receiveSupplierInvoice({
      supplier: "Beijer Bygg",
      invoiceNumber: "TH-771",
      amount: 5_000,
      vatAmount: 1_000,
      description: "Material",
      category: "material",
    });
    const original = db().verifications.find((v) => v.id === sup.verificationId)!;
    const before2440 = original.entries.find((e) => e.account === 2440)!.credit;
    const posted = postVerificationCorrection(original.id, { kind: "konto", category: "forsakring" });
    assert.ok(posted.replacement);
    assert.equal(posted.replacement!.entries.find((e) => e.account === 2440)?.credit, before2440);
    assert.equal(posted.replacement!.entries.find((e) => e.account === 6310)?.debit, 5_000);
    assert.equal(posted.replacement!.entries.some((e) => e.account === 2641), false);
    assert.ok(balanced(posted.replacement!.entries));
    assert.equal(sup.category, "forsakring");
    assert.equal(accountBalance(4010), 0);
  });
});

describe("Rätta bokföring – fel underlag", () => {
  beforeEach(() => reset());

  it("kundfaktura styrs till kreditflöde – ingen ledger-rättelse", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const ver = db().verifications.find((v) => v.source.type === "kundfaktura")!;
    const flow = inspectCorrectionFlow(ver.id);
    assert.equal(flow.kind, "kreditfaktura");
    assert.equal(flow.invoiceId, inv.id);
    assert.match(flow.href ?? "", /ekonomi\/fakturor/);
    assert.equal(flow.allowAdvanced, false);
    assert.throws(
      () => postVerificationCorrection(ver.id, { kind: "konto", category: "material" }),
      /kreditfaktura/i
    );
    assert.equal(ver.correctedByVerificationId, undefined);
  });

  it("A1 ocrediterad kundfaktura: overflow visar Fakturan är fel", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const ver = db().verifications.find((v) => v.source.type === "kundfaktura" && v.source.id === inv.id)!;
    const items = verificationOverflowItems(inspectCorrectionFlow(ver.id));
    assert.deepEqual(
      items.filter((i) => i.kind === "fakturan_ar_fel"),
      [{ kind: "fakturan_ar_fel", invoiceId: inv.id }]
    );
    assert.equal(items.some((i) => i.kind === "ratta_bokforing"), false);
  });

  it("A1 efter kredit: overflow döljer Fakturan är fel och originalet är orört", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const ver = db().verifications.find((v) => v.source.type === "kundfaktura" && v.source.id === inv.id)!;
    const before = JSON.stringify(ver.entries);
    creditInvoice(inv.id);
    const still = db().verifications.find((v) => v.id === ver.id)!;
    const flow = inspectCorrectionFlow(still.id);
    const items = verificationOverflowItems(flow);
    assert.equal(flow.kind, "krediterad");
    assert.equal(items.some((i) => i.kind === "fakturan_ar_fel"), false);
    assert.equal(JSON.stringify(still.entries), before);
    assert.equal(still.correctedByVerificationId, undefined);
    assert.throws(() => postVerificationCorrection(still.id, { kind: "konto", category: "material" }), /krediterad/i);
  });

  it("A2 kreditfaktura-verifikation: overflow döljer Fakturan är fel", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const credit = creditInvoice(inv.id);
    const creditVer = db().verifications.find((v) => v.source.type === "kundfaktura" && v.source.id === credit.id)!;
    assert.ok(creditVer);
    const flow = inspectCorrectionFlow(creditVer.id);
    const items = verificationOverflowItems(flow);
    assert.equal(flow.kind, "krediterad");
    assert.equal(items.some((i) => i.kind === "fakturan_ar_fel"), false);
    assert.equal(creditVer.correctedByVerificationId, undefined);
    assert.throws(() => postVerificationCorrection(creditVer.id, { kind: "konto", category: "material" }), /kreditfaktura/i);
  });

  it("fel betalningsmatchning omatchas – ingen rå kontering", () => {
    const inv = createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 10_000 })], rot: null });
    issueInvoice(inv.id);
    const bankBefore = accountBalance(1930);
    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    const ver = db().verifications.find((v) => v.source.type === "betalning")!;
    const flow = inspectCorrectionFlow(ver.id);
    assert.equal(flow.kind, "omatcha");
    assert.equal(flow.allowAdvanced, false);
    assert.throws(
      () => postVerificationCorrection(ver.id, { kind: "konto", category: "material" }),
      /matchning|kreditfaktura|konto/i
    );

    const posted = postVerificationCorrection(ver.id, { kind: "omatcha" });
    assert.ok(posted.reversal);
    assert.equal(posted.replacement, undefined);
    const payment = db().payments.find((p) => p.id === (ver.source as { id: string }).id)!;
    assert.equal(isPaymentLive(payment.id), false);
    assert.equal(inv.status, "skickad");
    assert.equal(accountBalance(1510), 12_500);
    assert.equal(accountBalance(1930), bankBefore);
  });

  it("främmande/okänt id blockeras", () => {
    assert.throws(() => inspectCorrectionFlow("ver-annan-verksamhet"), /finns inte/);
    assert.throws(() => postVerificationCorrection("ver-annan-verksamhet", { kind: "konto", category: "material" }), /finns inte/);
  });
});

describe("Rätta bokföring – AI", () => {
  beforeEach(() => reset());

  it("verktyget kräver bekräftelse och kan inte skriva råa debet/kredit", async () => {
    assert.equal(toolRisk("ratta_bokforing"), "CONFIRM_REQUIRED");
    assert.equal(toolRequiresConfirmation("ratta_bokforing"), true);
    const specs = (await import("./ai/tools")).assistantToolDefs();
    const def = specs.find((s) => s.function.name === "ratta_bokforing")!;
    const props = def.function.parameters as { properties: Record<string, unknown>; additionalProperties: boolean };
    assert.equal(props.additionalProperties, false);
    assert.equal("entries" in props.properties, false);
    assert.equal("debit" in props.properties, false);

    const expense = autoBookedExpense({ id: "exp-ai" });
    const original = db().verifications.find((v) => v.id === expense.verificationId)!;
    const countBefore = db().verifications.length;

    const propose = await executeTool(
      "ratta_bokforing",
      { query: verificationLabel(original), category: "material" },
      { origin: "ai" }
    );
    assert.equal(propose.ok, true);
    assert.equal(propose.requiresConfirmation, true);
    assert.equal(db().verifications.length, countBefore);

    const raw = await executeTool(
      "ratta_bokforing",
      { query: original.id, entries: [{ account: 4010, debit: 100, credit: 0 }] },
      { origin: "ai" }
    );
    assert.equal(raw.ok, false);
    assert.equal(db().verifications.length, countBefore);

    const action = db().pendingActions.find((a) => a.type === "ratta_bokforing");
    assert.ok(action);
    await confirmPendingAction(action!.id);
    const originalAfter = db().verifications.find((v) => v.id === original.id)!;
    assert.ok(originalAfter.correctedByVerificationId);
    assert.equal(JSON.stringify(originalAfter.entries), JSON.stringify(original.entries));
  });
});
