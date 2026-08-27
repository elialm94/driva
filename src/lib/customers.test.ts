process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, testCustomer, labor } from "./invoices/test-db";
import {
  countOpenInquiries,
  findMatchingOpenInquiry,
  listCustomersForTable,
  listInquiriesInbox,
} from "./services/customers";
import { createQuote, quoteDefaults } from "./services/quotes";
import { createInvoice } from "./services/invoices";
import { createJob } from "./services/jobs";
import type { Customer } from "./types";

function manyCustomers(n: number): Customer[] {
  return Array.from({ length: n }, (_, i) =>
    testCustomer({
      id: `cust-${i}`,
      name: `Kund ${String(i).padStart(4, "0")}`,
      email: `kund${i}@exempel.se`,
      phone: `070-${String(1000000 + i).slice(1)}`,
      kind: i % 7 === 0 ? "foretag" : "privat",
      orgNumber: i % 7 === 0 ? `559${String(i).padStart(3, "0")}-1234` : undefined,
      contactPerson: i % 7 === 0 ? `Kontakt ${i}` : undefined,
      createdAt: new Date(Date.now() - i * 3600_000).toISOString(),
    })
  );
}

describe("listCustomersForTable", () => {
  it("paginerar utan att lägga hela registret i resultatet", () => {
    replaceDb(emptyTestDb({ customers: manyCustomers(1000) }));
    const page = listCustomersForTable({ page: 3, pageSize: 50, sort: "namn" });
    assert.equal(page.rows.length, 50);
    assert.equal(page.total, 1000);
    assert.equal(page.totalPages, 20);
    assert.equal(page.page, 3);
    assert.equal(page.rows[0].name, "Kund 0100");
    assert.ok(!("notes" in page.rows[0]));
    assert.ok(!("requests" in page.rows[0]));
  });

  it("söker på namn, företag, e-post, telefon och org.nr", () => {
    replaceDb(emptyTestDb({ customers: manyCustomers(80) }));
    assert.equal(listCustomersForTable({ q: "kund 0012" }).total, 1);
    assert.equal(listCustomersForTable({ q: "kund12@exempel.se" }).total, 1);
    assert.ok(listCustomersForTable({ q: "070-000014" }).total >= 1);
    const company = listCustomersForTable({ q: "559014" });
    assert.ok(company.total >= 1);
    assert.equal(company.rows[0].kind, "foretag");
  });

  it("filtrerar typ, aktivitet och betalning från beräknad data", () => {
    const customers = [
      testCustomer({ id: "a", name: "Anna", kind: "privat" }),
      testCustomer({ id: "b", name: "Brf", kind: "foretag", orgNumber: "769612-3456", contactPerson: "Maria" }),
    ];
    replaceDb(emptyTestDb({ customers }));
    createJob({ customerId: "a", title: "Kök" });
    const inv = createInvoice({
      customerId: "b",
      type: "faktura",
      lines: [labor({ unitPrice: 8000 })],
      rot: null,
    });
    inv.status = "skickad";
    inv.dueDate = "2020-01-10";
    inv.issueDate = "2020-01-01";

    assert.equal(listCustomersForTable({ kind: "foretag" }).total, 1);
    assert.equal(listCustomersForTable({ activity: "uppdrag" }).rows[0].id, "a");
    assert.equal(listCustomersForTable({ payment: "forsenad" }).rows[0].id, "b");
    assert.ok(listCustomersForTable({ payment: "forsenad" }).rows[0].overdue);
    assert.ok(listCustomersForTable({ payment: "obetalt" }).rows[0].outstanding > 0);
  });

  it("sorterar på senast aktivitet som standard", () => {
    replaceDb(buildSeed());
    const page = listCustomersForTable({ sort: "aktivitet" });
    const times = page.rows.map((r) => r.lastActivityAt);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(times, sorted);
  });
});

describe("listInquiriesInbox", () => {
  beforeEach(() => {
    replaceDb(buildSeed());
  });

  it("visar bara öppna förfrågningar som standard", () => {
    const open = listInquiriesInbox();
    assert.ok(open.rows.every((r) => r.status === "ny"));
    assert.ok(open.rows.some((r) => /karin/i.test(r.customerName)));
    assert.ok(open.rows.some((r) => /sara/i.test(r.customerName)));
    assert.equal(countOpenInquiries(), open.total);
  });

  it("söker i kund, företag och meddelandetext", () => {
    const byBody = listInquiriesInbox({ q: "bokhylla" });
    assert.equal(byBody.total, 1);
    assert.match(byBody.rows[0].customerName, /Karin/i);
    const all = listInquiriesInbox({ filter: "alla", q: "köksrenovering" });
    assert.ok(all.total >= 1);
  });

  it("lämnar inboxen när offert skapas mot samma förfrågan", () => {
    const karin = findMatchingOpenInquiry("cust-karin", "bokhylla");
    assert.ok(karin);
    const defaults = quoteDefaults();
    createQuote({
      customerId: "cust-karin",
      requestId: karin.id,
      title: karin.title,
      intro: karin.message,
      lines: [],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    const open = listInquiriesInbox();
    assert.ok(!open.rows.some((r) => r.id === karin.id));
    const history = listInquiriesInbox({ filter: "alla", q: "karin" });
    assert.ok(history.rows.some((r) => r.id === karin.id && r.status === "hanterad"));
  });
});
