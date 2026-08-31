process.env.DRIVA_TEST = "1";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, testCustomer, labor } from "./invoices/test-db";
import { createCustomer, listCustomersForTable, updateCustomer } from "./services/customers";
import { createQuote, quoteDefaults, quoteSendBlockers, sendQuote } from "./services/quotes";
import { createInvoice } from "./services/invoices";
import { createJob, findMatchingUnquotedJob, isIncomingUnquotedJob } from "./services/jobs";
import { CustomerValidationError } from "./customer-validation";
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

/**
 * Kärnprincipen: Driva frågar efter uppgifter NÄR de behövs – inte före.
 * "Erik" → Skapa kund → klart. Flöden som skickar e-post, fakturerar eller
 * ansöker om ROT ber om sina uppgifter först när de faktiskt behövs.
 */
describe("skapa kund med bara namn", () => {
  it("privatperson: namnet räcker – e-post, telefon, adress, personnummer och fastighet är frivilliga", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const c = createCustomer({ kind: "privat", name: "Erik" });
    assert.equal(c.name, "Erik");
    assert.equal(c.email, "");
    assert.equal(c.phone, "");
    assert.equal(c.address, undefined);
    assert.equal(c.personalIdentityNumber, undefined);
    assert.equal(c.workLocations, undefined);
    assert.equal(listCustomersForTable({ q: "Erik" }).total, 1);
  });

  it("företag: samma minimiprincip – bara namnet krävs", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const c = createCustomer({ kind: "foretag", name: "Bygg AB" });
    assert.equal(c.kind, "foretag");
    assert.equal(c.email, "");
    assert.equal(c.orgNumber, undefined);
    assert.equal(c.contactPerson, undefined);
  });

  it("namn krävs fortfarande", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    assert.throws(
      () => createCustomer({ kind: "privat", name: "   " }),
      (e: unknown) => e instanceof CustomerValidationError && e.errors[0]?.field === "name"
    );
  });

  it("ifylld e-post formatvalideras fortfarande – vid skapande och uppdatering", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    assert.throws(
      () => createCustomer({ kind: "privat", name: "Erik", email: "inte en adress" }),
      (e: unknown) => e instanceof CustomerValidationError && e.errors[0]?.field === "email"
    );
    const c = createCustomer({ kind: "privat", name: "Erik" });
    assert.throws(
      () => updateCustomer(c.id, { email: "fel@" }),
      (e: unknown) => e instanceof CustomerValidationError && e.errors[0]?.field === "email"
    );
  });

  it("en befintlig e-post kan tömmas utan att autospar stoppas", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const c = createCustomer({ kind: "privat", name: "Erik", email: "erik@example.se" });
    updateCustomer(c.id, { email: "" });
    assert.equal(db().customers.find((x) => x.id === c.id)?.email, "");
  });
});

describe("skicka offert till kund utan e-post", () => {
  it("blockeraren namnger e-postadressen; efter komplettering fortsätter sändningen", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const erik = createCustomer({ kind: "privat", name: "Erik" });
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: erik.id,
      title: "Altanbygge",
      lines: [labor({ unitPrice: 50_000_00 })],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });

    // Exakt fält namnges – aldrig ett vagt "kan inte skicka".
    const blockers = quoteSendBlockers(quote.id);
    assert.deepEqual(
      blockers.map((b) => b.code),
      ["buyer_email"]
    );
    assert.match(blockers[0].message, /e-postadress/i);
    assert.equal(blockers[0].actionLabel, "Lägg till e-post");
    assert.equal(blockers[0].href, `/kunder/${erik.id}`);

    // Inline-kompletteringen sparar adressen på kundkortet …
    updateCustomer(erik.id, { email: "erik@example.se" });

    // … och det ursprungliga flödet fortsätter utan omstart.
    assert.deepEqual(quoteSendBlockers(quote.id), []);
    const sent = sendQuote(quote.id);
    assert.equal(sent.status, "skickad");
  });

  it("saknade företagsuppgifter ger samma checklista-mönster som fakturan", () => {
    replaceDb(emptyTestDb({ settings: { ...emptyTestDb().settings, name: "", orgNumber: "", address: "" } }));
    const defaults = quoteDefaults();
    const quote = createQuote({
      customerId: "cust-1",
      title: "",
      lines: [],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    const blockers = quoteSendBlockers(quote.id);
    const codes = blockers.map((b) => b.code);
    assert.ok(codes.includes("seller_name"));
    assert.ok(codes.includes("seller_orgnr"));
    assert.ok(codes.includes("seller_address"));
    assert.ok(codes.includes("quote_title"));
    assert.ok(codes.includes("lines_empty"));
    assert.equal(blockers.find((b) => b.code === "seller_name")?.href, "/installningar?flik=foretag");
    assert.equal(blockers.find((b) => b.code === "quote_title")?.href, `/ekonomi/offerter/${quote.id}/redigera`);
    assert.ok(!codes.includes("seller_bankgiro"));
  });
});

describe("inkommande uppdrag utan offert", () => {
  it("seedade webb-/telefonuppdrag syns som inkommande tills offert kopplas", () => {
    replaceDb(buildSeed());
    const karin = db().jobs.find((j) => j.id === "job-karin");
    const sara = db().jobs.find((j) => j.id === "job-sara");
    assert.ok(karin && isIncomingUnquotedJob(karin));
    assert.ok(sara && isIncomingUnquotedJob(sara));
    assert.equal(findMatchingUnquotedJob("cust-karin", "bokhylla")?.id, "job-karin");

    const defaults = quoteDefaults();
    createQuote({
      customerId: "cust-karin",
      jobId: "job-karin",
      title: karin.title,
      lines: [],
      rot: null,
      paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
      paymentTermsDays: defaults.paymentTermsDays,
      validUntil: defaults.validUntil,
      terms: defaults.terms,
    });
    assert.ok(!isIncomingUnquotedJob(db().jobs.find((j) => j.id === "job-karin")!));
  });
});
