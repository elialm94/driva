process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clampDeductionToRemaining,
  remainingTaxReduction,
  usedTaxReductionThisYear,
} from "./tax-reduction-used";
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

function paidRotInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
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
    ...over,
  } as unknown as Invoice;
}

describe("använt ROT i år", () => {
  it("räknar bara Fervas betalda fakturor - manuellt hos-andra ingår inte", () => {
    // Tidigare adderades taxReductionUsed (hos andra) in i samma summa, så ett
    // tomt fält blev 0 använt överallt. Hos-andra-fältet är borta från
    // kundkortet; Fervas siffra är bara egna fakturor.
    const used = usedTaxReductionThisYear({
      customer: customer({ taxReductionUsed: { year: 2026, rot: 10_000, rut: 0 } }),
      invoices: [paidRotInvoice()],
      year: 2026,
    });
    // 20 000 exkl. * 1,25 * 30 % = 7 500. Hos-andra 10 000 ska inte adderas.
    assert.equal(used.rot, 7_500);
    assert.equal(used.rut, 0);
    assert.equal(used.year, 2026);
  });

  it("tomt eller saknat hos-andra räknas inte som noll använt överallt", () => {
    const empty = usedTaxReductionThisYear({ customer: customer(), invoices: [], year: 2026 });
    const filled = usedTaxReductionThisYear({
      customer: customer({ taxReductionUsed: { year: 2026, rot: 10_000, rut: 5_000 } }),
      invoices: [],
      year: 2026,
    });
    assert.equal(empty.rot, 0);
    assert.equal(empty.rut, 0);
    assert.equal(filled.rot, 0);
    assert.equal(filled.rut, 0);
    // Samma Ferva-siffra oavsett ifyllt hos-andra: tomt är okänt, inte 0 använt.
    assert.equal(empty.rot, filled.rot);
    assert.equal(remainingTaxReduction(empty, "rot"), remainingTaxReduction(filled, "rot"));
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
