process.env.DRIVA_TEST = "1";

/**
 * Kortköp i banken → köp som saknar kvitto.
 *
 * Innan: en okänd utgående transaktion blev en stum bankrad ("Behöver
 * åtgärd"); bara demoseeden hade en utgift kopplad till kortköpet. Nu skapar
 * matchningsmotorn utgiften, så Hem visar "Kvitto saknas – …" med Lägg till
 * kvitto och kvittot bokför köpet mot just den transaktionen.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction } from "./types";
import { registerBankTransactions } from "./services/banking";
import { getBusinessActions } from "./services/actions";
import {
  createExpenseFromBankPurchase,
  looksLikeCardPurchase,
  provisionalVatFor,
  uploadReceiptForExpense,
} from "./services/expenses";

function reset() {
  replaceDb(
    emptyTestDb({
      bankAccounts: [
        {
          id: "acc-1",
          provider: "mock",
          name: "Företagskonto",
          accountNumber: "1234-5678",
          balance: 0,
          connectedAt: new Date().toISOString(),
        } satisfies BankAccount,
      ],
    })
  );
}

function outgoingTx(over: Partial<BankTransaction> & { amount: number }): BankTransaction {
  return {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: new Date().toISOString(),
    counterpart: "Circle K Årsta",
    description: "Kortköp",
    status: "ny",
    ...over,
  };
}

describe("Kortköp i banken blir köp som saknar kvitto", () => {
  beforeEach(() => reset());

  it("skapar en utgift kopplad till transaktionen med preliminär moms", () => {
    registerBankTransactions([outgoingTx({ amount: -812 })]);
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "behover_atgard");
    const expense = db().expenses.find((e) => e.bankTransactionId === tx.id);
    assert.ok(expense, "utgiften skapades");
    assert.equal(expense.status, "saknar_kvitto");
    assert.equal(expense.amount, 812, "beloppet är bankens");
    assert.equal(expense.supplier, "Circle K Årsta");
    assert.equal(expense.vatAmount, provisionalVatFor(812));
    assert.equal(provisionalVatFor(812), 162);
  });

  it("Hem visar Kvitto saknas i stället för en stum bankrad", () => {
    registerBankTransactions([outgoingTx({ amount: -812 })]);
    const tx = db().bankTransactions[0];
    const expense = db().expenses.find((e) => e.bankTransactionId === tx.id)!;
    const attention = getBusinessActions().attention;
    assert.ok(attention.some((a) => a.id === `receipt-${expense.id}`), "kvittoraden finns");
    assert.ok(!attention.some((a) => a.id === `bank-${tx.id}`), "bankraden dubbleras inte");
  });

  it("är idempotent per transaktion", () => {
    registerBankTransactions([outgoingTx({ amount: -812 })]);
    const tx = db().bankTransactions[0];
    assert.equal(createExpenseFromBankPurchase(tx), null);
    assert.equal(db().expenses.filter((e) => e.bankTransactionId === tx.id).length, 1);
  });

  it("skatt, överföringar, lön och bankavgifter blir inte köp", () => {
    for (const [counterpart, description] of [
      ["Skatteverket", "Skattekonto"],
      ["Eget sparkonto", "Överföring"],
      ["Anna Snickare", "Lön september"],
      ["SEB", "Månadsavgift företagspaket"],
    ] as const) {
      assert.equal(looksLikeCardPurchase({ amount: -500, counterpart, description }), false, counterpart);
    }
    assert.equal(looksLikeCardPurchase({ amount: 500, counterpart: "Kund", description: "Inbetalning" }), false);
    assert.equal(looksLikeCardPurchase({ amount: -500, counterpart: "Bauhaus", description: "Kortköp" }), true);

    registerBankTransactions([outgoingTx({ amount: -12_400, counterpart: "Skatteverket", description: "F-skatt" })]);
    assert.equal(db().expenses.length, 0, "skattebetalningen blev inte ett köp");
  });

  it("kvittots momsdelning ersätter schablonen när totalen stämmer med banken", () => {
    registerBankTransactions([outgoingTx({ amount: -812 })]);
    const expense = db().expenses[0];
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "foto", undefined, {
      supplier: "Circle K",
      amount: 812,
      vatAmount: 100,
    });
    assert.equal(expense.vatAmount, 100, "momsen kom från kvittot");
    assert.equal(expense.status, "bokford", "Circle K är en känd leverantör → bokförs automatiskt");
    const tx = db().bankTransactions[0];
    assert.equal(tx.status, "bokford");
    assert.equal(tx.matchedType, "utgift");
  });

  it("ett kvitto med annan total ändrar inte momsen", () => {
    registerBankTransactions([outgoingTx({ amount: -812 })]);
    const expense = db().expenses[0];
    uploadReceiptForExpense(expense.id, "kvitto.jpg", "foto", undefined, {
      supplier: "Circle K",
      amount: 1_299,
      vatAmount: 260,
    });
    assert.equal(expense.vatAmount, provisionalVatFor(812));
  });
});
