process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "../store";
import { emptyTestDb, labor, testCustomer } from "../invoices/test-db";
import { invoicesDueForReminder, quotesDueForFollowUp } from "./automatic-reminders";

function reset() {
  replaceDb(
    emptyTestDb({
      customers: [testCustomer()],
    })
  );
}

describe("automatiska påminnelser", () => {
  beforeEach(reset);

  it("offert som väntat 7 dagar utan uppföljning ska påminnas", () => {
    db().quotes.push({
      id: "q1",
      number: 1,
      customerId: "cust-1",
      status: "skickad",
      currentVersionId: "v1",
      token: "tok",
      followUps: [],
      createdAt: "2026-08-01T00:00:00.000Z",
      sentAt: "2026-08-01T00:00:00.000Z",
    } as never);
    db().quoteVersions.push({
      id: "v1",
      quoteId: "q1",
      version: 1,
      title: "Kök",
      lines: [labor()],
      rot: null,
      paymentPlan: [],
      paymentTermsDays: 30,
      validUntil: "2026-09-30",
      terms: "",
      createdAt: "2026-08-01T00:00:00.000Z",
    } as never);
    assert.deepEqual(quotesDueForFollowUp("2026-08-08"), ["q1"]);
    assert.deepEqual(quotesDueForFollowUp("2026-08-07"), []);
  });

  it("förfallen faktura påminns tidigast 7 dagar efter förfallodagen, max två gånger", () => {
    db().invoices.push({
      id: "i1",
      number: 100,
      customerId: "cust-1",
      status: "skickad",
      type: "faktura",
      dueDate: "2026-08-01",
      sentAt: "2026-07-01T00:00:00.000Z",
      token: "t",
      reminders: [],
      lines: [labor()],
    } as never);
    assert.deepEqual(invoicesDueForReminder("2026-08-08"), ["i1"]);
    db().invoices[0].reminders = ["2026-08-08T00:00:00.000Z"];
    assert.deepEqual(invoicesDueForReminder("2026-08-10"), []);
    assert.deepEqual(invoicesDueForReminder("2026-08-15"), ["i1"]);
    db().invoices[0].reminders = ["2026-08-08T00:00:00.000Z", "2026-08-15T00:00:00.000Z"];
    assert.deepEqual(invoicesDueForReminder("2026-08-30"), []);
  });
});
