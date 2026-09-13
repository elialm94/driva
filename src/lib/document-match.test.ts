process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { matchPurchaseDocuments } from "./document-match";
import type { PurchaseOrder, PurchaseOrderLine } from "./types";

function order(over: Partial<PurchaseOrder> & { lines?: PurchaseOrderLine[] }): PurchaseOrder & {
  lines: PurchaseOrderLine[];
  expectedCostKronor?: number;
  wholesalerName?: string;
} {
  return {
    id: over.id ?? "po-1",
    jobId: over.jobId ?? "job-1",
    connectionId: "conn-1",
    reference: over.reference ?? "FV-1042",
    status: over.status ?? "sent",
    channel: "email",
    delivery: { mode: "pickup" },
    ordererName: "Erik",
    ordererEmail: "erik@test.se",
    ordererPhone: "070-123 45 67",
    ccSelf: false,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    sentAt: over.sentAt ?? "2026-09-01T10:00:00.000Z",
    lines: over.lines ?? [],
    expectedCostKronor: 1248,
    wholesalerName: "Ahlsell",
  };
}

describe("dokumentmatchning", () => {
  it("10. leverantörsfaktura matchas mot skickad beställning", () => {
    const result = matchPurchaseDocuments({
      fervaRef: "FV-1042",
      amountKronor: 1248,
      supplier: "Ahlsell",
      date: "2026-09-02",
      orders: [order({ reference: "FV-1042" })],
    });
    assert.equal(result.kind, "exact");
    assert.equal(result.reference, "FV-1042");
  });

  it("12. faktiskt inköpspris avviker - osäker matchning ger frågan", () => {
    const result = matchPurchaseDocuments({
      supplier: "Ahlsell",
      amountKronor: 1400,
      date: "2026-09-02",
      orders: [order({ reference: "FV-1042" })],
    });
    assert.equal(result.kind, "uncertain");
    assert.match(result.question ?? "", /FV-1042/);
  });

  it("utkast och avbrutna order matchas inte", () => {
    const result = matchPurchaseDocuments({
      fervaRef: "FV-1042",
      orders: [order({ status: "draft" })],
    });
    assert.equal(result.kind, "none");
  });
});
