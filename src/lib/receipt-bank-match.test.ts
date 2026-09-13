process.env.DRIVA_TEST = "1";

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { emptyTestDb } from "./invoices/test-db";
import { matchReceiptToTransaction } from "./services/expenses";
import type { BankAccount, BankTransaction } from "./types";

function reset(transactions: BankTransaction[]) {
  replaceDb(
    emptyTestDb({
      bankAccounts: [
        {
          id: "acc-1",
          provider: "mock",
          name: "Företagskonto",
          accountNumber: "1234-5678",
          balance: 0,
          connectedAt: "2026-09-01T00:00:00.000Z",
        } satisfies BankAccount,
      ],
      bankTransactions: transactions,
    })
  );
}

describe("kvitto mot bank (materialkedjan)", () => {
  beforeEach(() => {
    reset([]);
  });

  it("8. kvitto matchas mot banktransaktion på belopp och leverantör", () => {
    reset([
      {
        id: "tx-1",
        accountId: "acc-1",
        date: "2026-09-01",
        counterpart: "Ahlsell Stockholm",
        description: "Köp",
        amount: -1248,
        status: "ny",
      },
    ]);
    const match = matchReceiptToTransaction({
      supplier: "Ahlsell",
      amount: 1248,
      date: "2026-09-01",
    });
    assert.ok(match);
    assert.equal(match.transactionId, "tx-1");
    assert.equal(match.confidence, "hog");
  });

  it("entydigt belopp inom tre dagar ger medelkonfidens", () => {
    reset([
      {
        id: "tx-2",
        accountId: "acc-1",
        date: "2026-09-03",
        counterpart: "Okänd handel",
        description: "Kortköp",
        amount: -400,
        status: "ny",
      },
    ]);
    const match = matchReceiptToTransaction({
      supplier: "Byggmax",
      amount: 400,
      date: "2026-09-01",
    });
    assert.ok(match);
    assert.equal(match.confidence, "medel");
  });
});
