process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { clampDeductionToRemaining, remainingTaxReduction, usedTaxReductionThisYear } from "./tax-reduction-used";
import type { Customer, Invoice } from "./types";

function customer(over: Partial<Customer> = {}): Customer {
  return {
    id: "c1",
    kind: "privat",
    name: "Anna",
    email: "",
    phone: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("använt ROT i år", () => {
  it("räknar manuellt ifyllt plus betalda egna fakturor", () => {
    const used = usedTaxReductionThisYear({
      customer: customer({ taxReductionUsed: { year: 2026, rot: 10_000, rut: 0 } }),
      invoices: [
        {
          id: "i1",
          customerId: "c1",
          status: "betald",
          type: "faktura",
          issueDate: "2026-03-01",
          paidAt: "2026-03-10",
          rot: { type: "rot", appliedTaxReduction: 8_000 },
          issuedSnapshot: {
            lines: [{ id: "l", kind: "arbete", description: "Jobb", qty: 1, unit: "tim", unitPrice: 20000, vatRate: 25 }],
            rot: { type: "rot", appliedTaxReduction: 8_000 },
          },
        } as unknown as Invoice,
      ],
      year: 2026,
    });
    assert.equal(used.rot >= 10_000, true);
    assert.equal(used.year, 2026);
  });

  it("kvarvarande tar hänsyn till eget tak och det gemensamma", () => {
    assert.equal(remainingTaxReduction({ year: 2026, rot: 40_000, rut: 0 }, "rot"), 10_000);
    assert.equal(remainingTaxReduction({ year: 2026, rot: 40_000, rut: 30_000 }, "rot"), 5_000);
  });

  it("sänker avdraget när utrymmet är slut", () => {
    const r = clampDeductionToRemaining(15_000, 4_000);
    assert.equal(r.applied, 4_000);
    assert.equal(r.limited, true);
  });
});
