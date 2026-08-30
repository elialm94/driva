process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb, labor } from "./invoices/test-db";
import { getBusinessActions } from "./services/actions";
import {
  ACCOUNTING_EXCEPTIONS_GROUP_ID,
  ACCOUNTING_GROUP_THRESHOLD,
  BOOKKEEPING_PAGE_SUBTITLE,
  BOOKKEEPING_SECTION_TITLE,
  BOOKKEEPING_UNRESOLVED_HREF,
  BOOKKEEPING_UNRESOLVED_VISA,
  bookkeepingGroupTitle,
  bookkeepingQueue,
  bookkeepingStatusHeadline,
  isBookkeepingUnresolvedVisa,
  isGroupableBookkeeping,
  projectHomeAttention,
} from "./services/action-views";
import { actionResolveHref, controlsForAction, issueForAction } from "./services/action-issue";
import { snoozeAttention } from "./services/attention-state";
import { createInvoice, issueInvoice, markInvoicePaid } from "./services/invoices";
import { answerExpenseQuestion } from "./services/expenses";
import { accountantQueue } from "./collaboration/issues";
import { isoDaysFromNow } from "./format";
import type { Expense } from "./types";
import type { Invoice } from "./types";

function issueAndDeliver(inv: Invoice): Invoice {
  const issued = issueInvoice(inv.id);
  issued.sentAt = issued.issuedAt;
  return issued;
}

function addExpense(over: Partial<Expense> & Pick<Expense, "id" | "status" | "supplier">): Expense {
  const e: Expense = {
    date: isoDaysFromNow(-2),
    amount: 400,
    vatAmount: 80,
    createdAt: isoDaysFromNow(-2),
    ...over,
  };
  db().expenses.push(e);
  return e;
}

function lateInvoice() {
  const inv = issueAndDeliver(
    createInvoice({ customerId: "cust-1", type: "faktura", lines: [labor({ unitPrice: 12_000 })], rot: null })
  );
  inv.dueDate = isoDaysFromNow(-7);
  return inv;
}

describe("Hem- och Bokföringsvyer: samma åtgärdsmotor", () => {
  it("Bokföringstexter är domänspecifika – inte en andra uppmärksamhetsinbox", () => {
    assert.equal(BOOKKEEPING_SECTION_TITLE, "Behöver lösas");
    assert.match(BOOKKEEPING_PAGE_SUBTITLE, /automatiskt i bakgrunden/);
    assert.equal(bookkeepingStatusHeadline(0), "Bokföringen är uppdaterad");
    assert.equal(bookkeepingStatusHeadline(1), "1 bokföringsfråga att lösa");
    assert.equal(bookkeepingStatusHeadline(2), "2 bokföringsfrågor att lösa");
    assert.equal(bookkeepingGroupTitle(3), "3 bokföringsfrågor behöver hanteras");
    assert.equal(isBookkeepingUnresolvedVisa(BOOKKEEPING_UNRESOLVED_VISA), true);
    assert.equal(isBookkeepingUnresolvedVisa(undefined), false);
    assert.match(BOOKKEEPING_UNRESOLVED_HREF, /visa=olosta/);
    assert.match(BOOKKEEPING_UNRESOLVED_HREF, /#behover-losas/);
  });

  it("få bokföringsundantag syns med samma id på Hem och Bokföring", () => {
    replaceDb(emptyTestDb());
    addExpense({
      id: "exp-clas",
      supplier: "Clas Ohlson",
      status: "saknar_kvitto",
      amount: 349,
      vatAmount: 70,
    });
    addExpense({
      id: "exp-hotel",
      supplier: "Grand Hôtel",
      status: "behover_svar",
      amount: 4_250,
      vatAmount: 510,
      question: { text: "Vad gällde Grand Hôtel?", options: ["Kundmöte", "Privat"] },
    });

    const engine = getBusinessActions().attention;
    const receiptId = "receipt-exp-clas";
    const questionId = "question-exp-hotel";
    assert.ok(engine.some((a) => a.id === receiptId));
    assert.ok(engine.some((a) => a.id === questionId));

    const books = bookkeepingQueue(engine);
    const home = projectHomeAttention(engine);
    assert.ok(books.some((a) => a.id === receiptId));
    assert.ok(books.some((a) => a.id === questionId));
    assert.ok(home.some((a) => a.id === receiptId), "under tröskeln: samma rad på Hem");
    assert.ok(home.some((a) => a.id === questionId));
    assert.ok(!home.some((a) => a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID));
    assert.equal(books.find((a) => a.id === receiptId), engine.find((a) => a.id === receiptId));
  });

  it("många rutinundantag grupperas på Hem men ligger kvar kompletta i Bokföring", () => {
    replaceDb(emptyTestDb());
    const inv = lateInvoice();
    for (const [id, supplier] of [
      ["exp-clas", "Clas Ohlson"],
      ["exp-bauhaus", "Bauhaus"],
      ["exp-ikea", "IKEA"],
      ["exp-biltema", "Biltema"],
      ["exp-jula", "Jula"],
      ["exp-hornbach", "Hornbach"],
      ["exp-k-rauta", "K-Rauta"],
      ["exp-hotel", "Grand Hôtel"],
    ] as const) {
      addExpense({
        id,
        supplier,
        status: supplier === "Grand Hôtel" ? "behover_svar" : "saknar_kvitto",
        question:
          supplier === "Grand Hôtel"
            ? { text: "Vad gällde Grand Hôtel?", options: ["Kundmöte", "Privat"] }
            : undefined,
      });
    }

    const engine = getBusinessActions().attention;
    const groupable = engine.filter(isGroupableBookkeeping);
    assert.ok(groupable.length >= ACCOUNTING_GROUP_THRESHOLD);
    assert.ok(groupable.length >= 8, "åtta bokföringsundantag i motorn");

    const books = bookkeepingQueue(engine);
    assert.ok(books.filter((a) => a.id.startsWith("receipt-") || a.id.startsWith("question-")).length >= 8);
    assert.ok(!books.some((a) => a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID), "Bokföring grupperar inte");

    const home = projectHomeAttention(engine);
    const group = home.find((a) => a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID);
    assert.ok(group, "Hem visar en grupprad");
    assert.match(group.title, /bokföringsfrågor behöver hanteras/);
    assert.equal(group.cta?.type, "link");
    if (group.cta?.type === "link") {
      assert.equal(group.cta.label, "Öppna bokföring");
      assert.equal(group.cta.href, BOOKKEEPING_UNRESOLVED_HREF);
    }
    assert.equal(group.href, BOOKKEEPING_UNRESOLVED_HREF);
    assert.equal(actionResolveHref(group), BOOKKEEPING_UNRESOLVED_HREF);
    assert.equal(issueForAction(group), "Bokföringsfrågor");
    assert.equal(controlsForAction(group).canSnooze, false);

    assert.ok(!home.some((a) => a.id.startsWith("receipt-")), "enskilda kvitton döljs bakom gruppen");
    assert.ok(!home.some((a) => a.id.startsWith("question-")));

    const late = home.find((a) => a.id === `invoice-late-${inv.id}`);
    assert.ok(late, "försenad kundfaktura drunknar inte");
    assert.ok(home.indexOf(late) < home.indexOf(group), "deadline före bokföringsgruppen");

    const homeBookkeepingSlots = home.filter(
      (a) => a.category === "accounting" || a.category === "vat" || a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID
    ).length;
    assert.ok(homeBookkeepingSlots < 8, "åtta undantag tar inte åtta Hem-platser");
  });

  it("samma åtgärds-id: snooze och lösning gäller överallt", () => {
    replaceDb(emptyTestDb());
    addExpense({ id: "exp-clas", supplier: "Clas Ohlson", status: "saknar_kvitto" });
    addExpense({
      id: "exp-hotel",
      supplier: "Grand Hôtel",
      status: "behover_svar",
      question: { text: "Vad gällde Grand Hôtel?", options: ["Kundmöte", "Privat"] },
    });
    const receiptId = "receipt-exp-clas";
    const questionId = "question-exp-hotel";
    const now = new Date();

    assert.ok(getBusinessActions(now).attention.some((a) => a.id === receiptId));
    assert.ok(bookkeepingQueue(getBusinessActions(now).attention).some((a) => a.id === receiptId));

    snoozeAttention(receiptId, "imorgon", now);
    const afterSnooze = getBusinessActions(now).attention;
    assert.ok(!afterSnooze.some((a) => a.id === receiptId), "borta från motorn");
    assert.ok(!bookkeepingQueue(afterSnooze).some((a) => a.id === receiptId), "borta från Bokföring");
    assert.ok(!projectHomeAttention(afterSnooze).some((a) => a.id === receiptId), "borta från Hem");
    assert.ok(afterSnooze.some((a) => a.id === questionId), "andra frågan kvar");
    assert.equal(db().attentionStates.filter((s) => s.actionId === receiptId).length, 1);
    assert.equal(db().attentionStates.filter((s) => s.actionId === questionId).length, 0);

    answerExpenseQuestion("exp-hotel", "Kundmöte");
    const afterAnswer = getBusinessActions(now).attention;
    assert.ok(!afterAnswer.some((a) => a.id === questionId));
    assert.ok(!bookkeepingQueue(afterAnswer).some((a) => a.id === questionId));
    assert.ok(!projectHomeAttention(afterAnswer).some((a) => a.id === questionId));
  });

  it("moms och bank stannar som egna Hem-rader – gruppen tar bara rutinundantag", () => {
    replaceDb(emptyTestDb());
    addExpense({ id: "exp-a", supplier: "Clas Ohlson", status: "saknar_kvitto" });
    addExpense({ id: "exp-b", supplier: "Bauhaus", status: "saknar_kvitto" });
    addExpense({ id: "exp-c", supplier: "IKEA", status: "saknar_kvitto" });
    db().bankAccounts.push({
      id: "acc-1",
      provider: "mock",
      name: "Företagskonto",
      accountNumber: "1234-5678",
      balance: 2_500,
      connectedAt: new Date().toISOString(),
    });
    db().bankTransactions.push({
      id: "tx-1",
      accountId: "acc-1",
      date: isoDaysFromNow(-1),
      amount: 2_500,
      counterpart: "Okänd Betalare",
      description: "Inbetalning",
      status: "behover_atgard",
    });

    const engine = getBusinessActions().attention;
    assert.ok(engine.some((a) => a.id === "bank-tx-1"));
    const home = projectHomeAttention(engine);
    assert.ok(home.some((a) => a.id === "bank-tx-1"), "bankmatchning är egen rad");
    assert.ok(home.some((a) => a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID));
    assert.ok(!home.some((a) => a.id.startsWith("receipt-")));

    const books = bookkeepingQueue(engine);
    assert.ok(books.some((a) => a.id === "bank-tx-1"));
    assert.ok(books.some((a) => a.id === "receipt-exp-a"));
  });

  it("redovisningskön återanvänder samma id:n – ingen grupprad, ingen tredje kopia", () => {
    replaceDb(emptyTestDb());
    addExpense({ id: "exp-clas", supplier: "Clas Ohlson", status: "saknar_kvitto" });
    addExpense({ id: "exp-bauhaus", supplier: "Bauhaus", status: "saknar_kvitto" });
    addExpense({
      id: "exp-hotel",
      supplier: "Grand Hôtel",
      status: "behover_svar",
      question: { text: "Vad gällde Grand Hôtel?", options: ["Hotell", "Privat"] },
    });

    const engine = getBusinessActions().attention;
    const queue = accountantQueue(engine);
    assert.ok(queue.some((a) => a.id === "receipt-exp-clas"));
    assert.ok(queue.some((a) => a.id === "question-exp-hotel"));
    assert.ok(!queue.some((a) => a.id === ACCOUNTING_EXCEPTIONS_GROUP_ID));
    for (const row of queue) {
      assert.ok(engine.some((a) => a.id === row.id), `${row.id} måste komma ur motorn`);
    }
  });

  it("löst kvitto försvinner ur motor, Hem, Bokföring och redovisningskö", () => {
    replaceDb(emptyTestDb());
    const inv = lateInvoice();
    addExpense({ id: "exp-clas", supplier: "Clas Ohlson", status: "saknar_kvitto" });
    const receiptId = "receipt-exp-clas";
    assert.ok(getBusinessActions().attention.some((a) => a.id === receiptId));

    db().expenses.find((e) => e.id === "exp-clas")!.status = "bokford";
    const after = getBusinessActions().attention;
    assert.ok(!after.some((a) => a.id === receiptId));
    assert.ok(!bookkeepingQueue(after).some((a) => a.id === receiptId));
    assert.ok(!projectHomeAttention(after).some((a) => a.id === receiptId));
    assert.ok(!accountantQueue(after).some((a) => a.id === receiptId));
    assert.ok(after.some((a) => a.id === `invoice-late-${inv.id}`));

    markInvoicePaid(inv.id, { matchedBy: "manuell" });
    assert.ok(!getBusinessActions().attention.some((a) => a.id === `invoice-late-${inv.id}`));
  });
});
