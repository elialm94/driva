process.env.DRIVA_TEST = "1";

/**
 * Bankrader som fastnade utan köp.
 *
 * `processIncomingTransaction` kör EN gång, vid importen. Rader som
 * importerades innan kortköpsgrenen fanns – eller medan motorn hade ett
 * förslag som sedan försvunnit – blev därför liggande som "Välj typ" utan
 * utgift, och Utgifter var tom. Importen hoppar över kända externalId, så
 * Uppdatera hjälper inte: ingenting kör matchningen igen för en befintlig rad.
 *
 * `ensureBankPurchaseExpenses` är den reparationen. Den kör om exakt samma
 * gren som importen: obokad, negativ, inget förslag just nu och ser ut som ett
 * kortköp. Allt annat lämnas orört.
 */

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { db, replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { uid } from "./ids";
import type { BankAccount, BankTransaction, Expense, SupplierInvoice } from "./types";
import { registerBankTransactions } from "./services/banking";
import { getBusinessActions } from "./services/actions";
import { ensureBankPurchaseExpenses } from "./services/payment-matching";
import { listBankForTable, listExpensesForTable } from "./services/economy-list";
import { provisionalVatFor } from "./services/expenses";

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

/**
 * En rad som den låg i produktion: importerad och parkerad som "behöver
 * åtgärd" utan att någon utgift skapades. Läggs in direkt i lagret eftersom
 * importvägen numera skapar köpet – det är just den historiken som saknas.
 */
function strandedTx(over: Partial<BankTransaction> & { amount: number; counterpart: string }): BankTransaction {
  const tx: BankTransaction = {
    id: uid(),
    accountId: "acc-1",
    externalId: `ext-${uid()}`,
    date: "2026-08-14",
    description: "Kortköp",
    status: "behover_atgard",
    ...over,
  };
  db().bankTransactions.push(tx);
  return tx;
}

function bankRow(txId: string) {
  return listBankForTable().rows.find((r) => r.id === txId)!;
}

describe("Bankrader som fastnade utan köp repareras", () => {
  beforeEach(() => reset());

  it("en omatchad utgående rad blir ett köp som saknar kvitto", () => {
    const vapiano = strandedTx({ amount: -180, counterpart: "Vapiano" });
    const ica = strandedTx({ amount: -300, counterpart: "Ica" });

    assert.equal(db().expenses.length, 0, "utgångsläget: ingen utgift finns");

    const created = ensureBankPurchaseExpenses();

    assert.equal(created.length, 2);
    const forVapiano = db().expenses.find((e) => e.bankTransactionId === vapiano.id);
    assert.ok(forVapiano, "Vapiano fick en utgift");
    assert.equal(forVapiano.status, "saknar_kvitto");
    assert.equal(forVapiano.supplier, "Vapiano");
    assert.equal(forVapiano.amount, 180, "beloppet är bankens");
    assert.equal(forVapiano.vatAmount, provisionalVatFor(180));
    assert.equal(forVapiano.date, "2026-08-14");

    const forIca = db().expenses.find((e) => e.bankTransactionId === ica.id);
    assert.ok(forIca, "Ica fick en utgift");
    assert.equal(forIca.status, "saknar_kvitto");
    assert.equal(forIca.amount, 300);

    // Hem: "Kvitto saknas – Vapiano, 180 kr" i stället för en stum bankrad.
    const attention = getBusinessActions().attention;
    assert.ok(attention.some((a) => a.id === `receipt-${forVapiano.id}`), "kvittoraden finns på Hem");
    assert.ok(!attention.some((a) => a.id === `bank-${vapiano.id}`), "bankraden dubbleras inte");
  });

  it("bankraden visar Kvitto saknas i stället för Välj typ", () => {
    const tx = strandedTx({ amount: -180, counterpart: "Vapiano" });

    const before = bankRow(tx.id);
    assert.equal(before.statusLabel, "Välj typ", "buggen: raden ber om en typ");
    assert.equal(before.action?.kind, "categorize");
    assert.equal(before.action?.reason, "Utgående betalning utan känd motpart");

    ensureBankPurchaseExpenses();

    const after = bankRow(tx.id);
    assert.equal(after.statusLabel, "Kvitto saknas");
    assert.equal(after.action?.kind, "receipt");
  });

  it("Utgifter listar köpet med Lägg till kvitto i stället för att vara tom", () => {
    strandedTx({ amount: -180, counterpart: "Vapiano" });
    assert.equal(listExpensesForTable().total, 0, "buggen: Inga utgifter ännu");

    ensureBankPurchaseExpenses();

    const rows = listExpensesForTable().rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].supplier, "Vapiano");
    assert.equal(rows[0].statusLabel, "Saknar kvitto");
    assert.equal(rows[0].inlineAction?.kind, "receipt");
  });

  it("är idempotent – två körningar ger ett köp", () => {
    const tx = strandedTx({ amount: -180, counterpart: "Vapiano" });

    assert.equal(ensureBankPurchaseExpenses().length, 1);
    assert.equal(ensureBankPurchaseExpenses().length, 0, "andra körningen skapar inget");
    assert.equal(db().expenses.filter((e) => e.bankTransactionId === tx.id).length, 1);
  });

  it("rör aldrig bokförda rader, inbetalningar eller rader som redan har ett underlag", () => {
    strandedTx({ amount: -900, counterpart: "Bauhaus", status: "bokford" });
    strandedTx({ amount: 12_500, counterpart: "Anna Andersson", description: "Inbetalning bankgiro" });

    const withExpense = strandedTx({ amount: -450, counterpart: "Clas Ohlson" });
    db().expenses.push({
      id: "exp-1",
      supplier: "Clas Ohlson",
      date: "2026-08-14",
      amount: 450,
      vatAmount: 90,
      status: "behover_svar",
      bankTransactionId: withExpense.id,
      createdAt: new Date().toISOString(),
    } satisfies Expense);

    const supplierTx = strandedTx({ amount: -6_250, counterpart: "Beijer Byggmaterial" });
    db().supplierInvoices.push({
      id: "sup-1",
      supplier: "Beijer Byggmaterial",
      invoiceNumber: "F-771",
      date: "2026-08-01",
      dueDate: "2026-08-31",
      amount: 6_250,
      vatAmount: 1_250,
      description: "Virke",
      category: "material",
      status: "betald",
      accountingStatus: "bokford",
      bankTransactionId: supplierTx.id,
      createdAt: new Date().toISOString(),
    } satisfies SupplierInvoice);

    const paidTx = strandedTx({ amount: -3_000, counterpart: "Snickeri Nord" });
    db().payments.push({
      id: "pay-1",
      invoiceId: "inv-1",
      bankTransactionId: paidTx.id,
      amount: -3_000,
      date: "2026-08-14",
      matchedBy: "manuell",
    });

    assert.deepEqual(ensureBankPurchaseExpenses(), []);
    assert.equal(db().expenses.length, 1, "bara den befintliga utgiften finns kvar");
    assert.equal(db().expenses[0].id, "exp-1");
  });

  it("Hyra, Lön och Ränta påverkas inte", () => {
    const hyra = strandedTx({ amount: -9_500, counterpart: "Fastighets AB Karlsson", description: "Hyra lokal augusti" });
    const lon = strandedTx({ amount: 28_400, counterpart: "Södermalms Snickeri", description: "Lön augusti" });
    const ranta = strandedTx({ amount: -1_240, counterpart: "SEB", description: "Ränta företagslån" });

    assert.deepEqual(ensureBankPurchaseExpenses(), [], "inget av dem är ett kortköp");

    assert.equal(bankRow(hyra.id).action?.kind, "book_kind");
    assert.equal(bankRow(hyra.id).statusLabel, "Förslag: Lokalhyra");
    assert.equal(bankRow(lon.id).action?.kind, "pick_invoice");
    assert.equal(bankRow(ranta.id).action?.kind, "book_kind");
    assert.equal(bankRow(ranta.id).statusLabel, "Förslag: Ränta på lån");
  });

  it("importvägen skapar köpet direkt – reparationen har inget att göra", () => {
    registerBankTransactions([
      {
        id: uid(),
        accountId: "acc-1",
        externalId: "ext-vapiano",
        date: "2026-08-14",
        amount: -180,
        counterpart: "Vapiano",
        description: "Kortköp",
        status: "ny",
      },
    ]);

    const expense = db().expenses.find((e) => e.supplier === "Vapiano");
    assert.ok(expense, "importen skapade köpet");
    assert.equal(expense.status, "saknar_kvitto");
    assert.deepEqual(ensureBankPurchaseExpenses(), []);
  });
});
