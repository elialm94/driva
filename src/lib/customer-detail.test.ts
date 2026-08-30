process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createCustomer, listCustomersForTable, updateCustomer } from "./services/customers";
import {
  addWorkLocation,
  findWorkLocationByHint,
  setCustomerPersonnummer,
  syncCustomerProperties,
  workLocationsForModel,
} from "./services/work-locations";
import { CustomerValidationError, sanitizePropertyDesignations, workLocationFieldErrors } from "./customer-validation";
import { createJob } from "./services/jobs";
import { createInvoice, issueInvoice } from "./services/invoices";
import { compactCustomer } from "./ai/domain";
import { customerActivityFeed, customerMoneyLine } from "./services/customer-activity";
import { currentVersion, getInvoice, requireCustomer } from "./services/data";
import { resolveTaxReductionPrefill } from "./services/tax-reduction";
import { maskPersonnummer } from "./personnummer";

describe("bostäder och personnummer", () => {
  beforeEach(() => {
    replaceDb(
      emptyTestDb({
        customers: [
          testCustomer({
            id: "cust-johan",
            name: "Johan Lindberg",
            kind: "privat",
            address: "Tantogatan 27",
            postalCode: "118 42",
            city: "Stockholm",
          }),
        ],
      })
    );
  });

  it("kund kan ha flera bostäder, default används, uppdrag kan välja en annan", () => {
    const hem = addWorkLocation("cust-johan", {
      label: "Hem",
      address: "Tantogatan 27",
      postalCode: "118 42",
      city: "Stockholm",
      propertyType: "smahus",
      propertyDesignation: "Södermalm 1:1",
      asDefault: true,
    });
    const fritid = addWorkLocation("cust-johan", {
      label: "Fritidshus",
      address: "Bryggvägen 4",
      postalCode: "760 40",
      city: "Väddö",
      propertyType: "smahus",
      propertyDesignation: "Väddö 12:3",
    });
    const customer = requireCustomer("cust-johan");
    assert.equal(customer.defaultWorkLocationId, hem.id);
    assert.equal(customer.workLocations?.length, 2);

    const defaultJob = createJob({ customerId: "cust-johan", title: "Kök" });
    assert.equal(defaultJob.workLocationId, hem.id);
    assert.match(defaultJob.address ?? "", /Tantogatan/);
    assert.equal(defaultJob.housing?.propertyDesignation, "Södermalm 1:1");

    const other = createJob({ customerId: "cust-johan", title: "Altan", workLocationId: fritid.id });
    assert.equal(other.workLocationId, fritid.id);
    assert.match(other.address ?? "", /Bryggvägen/);
    assert.equal(other.housing?.propertyDesignation, "Väddö 12:3");
    assert.equal(findWorkLocationByHint(requireCustomer("cust-johan"), "fritidshus")?.id, fritid.id);
  });

  it("personnummer ligger på kunden, maskas i read-models och återanvänds på ROT-faktura från uppdrag", () => {
    setCustomerPersonnummer("cust-johan", "19850515-1234");
    const hem = addWorkLocation("cust-johan", {
      label: "Hem",
      address: "Tantogatan 27",
      postalCode: "118 42",
      city: "Stockholm",
      propertyType: "smahus",
      propertyDesignation: "Södermalm 1:1",
    });
    const job = createJob({ customerId: "cust-johan", title: "Kök", workLocationId: hem.id });
    const inv = createInvoice({
      customerId: "cust-johan",
      jobId: job.id,
      type: "faktura",
      lines: [labor({ unitPrice: 8000 })],
      rot: { type: "rot" },
    });

    const customer = requireCustomer("cust-johan");
    assert.equal(customer.personalIdentityNumber, "19850515-1234");
    assert.equal(inv.taxReductionDetails?.housing?.propertyDesignation, "Södermalm 1:1");
    const prefill = resolveTaxReductionPrefill({ customerId: "cust-johan", jobId: job.id });
    assert.equal(prefill.personalIdentityNumberMasked, "1985••••-1234");
    assert.ok(!prefill.personalIdentityNumberMasked.includes("0515"));

    const compact = compactCustomer(customer);
    assert.equal("personalIdentityNumber" in compact, false);
    assert.equal(compact.hasPersonalIdentityNumber, true);
    assert.deepEqual(
      workLocationsForModel(customer).map((l) => l.label),
      ["Hem"]
    );
    const row = listCustomersForTable({ q: "Johan" }).rows[0];
    assert.ok(row);
    assert.equal("personalIdentityNumber" in row, false);
    assert.equal(JSON.stringify(row).includes("19850515"), false);
  });
});

describe("immutabla snapshots", () => {
  it("utfärdad fakturaadress ändras inte när kundadress, PN eller bostad ändras", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-1", address: "Folkungagatan 1", city: "Stockholm" })],
      })
    );
    const inv = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 5000 })],
      rot: null,
    });
    issueInvoice(inv.id);
    updateCustomer("cust-1", { address: "Ny adress 99", city: "Göteborg" });
    setCustomerPersonnummer("cust-1", "19791115-1234");
    addWorkLocation("cust-1", {
      label: "Fritidshus",
      address: "Bryggvägen 4",
      city: "Väddö",
      propertyType: "smahus",
    });
    const stored = getInvoice(inv.id)!;
    assert.equal(stored.issuedSnapshot?.buyer.address, "Folkungagatan 1");
    assert.equal(stored.issuedSnapshot?.buyer.city, "Stockholm");
  });

  it("låst offertversion ändras inte när kunduppgifter ändras", () => {
    replaceDb(buildSeed());
    const before = currentVersion(db().quotes.find((q) => q.id === "quote-altan")!);
    assert.ok(before.lockedAt);
    const hash = before.contentHash;
    const lockedAt = before.lockedAt;
    updateCustomer("cust-johan", { address: "Annan gata 1", phone: "070-000 00 00" });
    const after = currentVersion(db().quotes.find((q) => q.id === "quote-altan")!);
    assert.equal(after.contentHash, hash);
    assert.equal(after.lockedAt, lockedAt);
    assert.equal(after.intro, before.intro);
  });
});

describe("kundaktivitet", () => {
  it("sorterar nyast först och länkar till objekten", () => {
    replaceDb(buildSeed());
    const rows = customerActivityFeed("cust-johan");
    assert.ok(rows.length > 0);
    const times = rows.map((r) => r.at);
    const sorted = [...times].sort((a, b) => b.localeCompare(a));
    assert.deepEqual(times, sorted);
    assert.ok(rows.some((r) => (r.kinds ?? [r.kind]).includes("faktura") && (r.href.includes("/ekonomi/fakturor/") || r.members?.some((m) => m.href.includes("/ekonomi/fakturor/")))));
    assert.ok(rows.some((r) => (r.kinds ?? [r.kind]).includes("offert") && (r.href.includes("/ekonomi/offerter/") || r.members?.some((m) => m.href.includes("/ekonomi/offerter/")))));
    assert.ok(rows.some((r) => (r.kinds ?? [r.kind]).includes("uppdrag") && (r.href.includes("/uppdrag/") || r.members?.some((m) => m.href.includes("/uppdrag/")))));
    assert.ok(rows.some((r) => (r.kinds ?? [r.kind]).includes("betalning")));
    const money = customerMoneyLine("cust-johan");
    assert.ok(money);
    assert.ok(money.avtalat > 0 || money.fakturerat > 0);
  });
});

describe("maskning", () => {
  it("maskPersonnummer döljer mitten", () => {
    assert.equal(maskPersonnummer("19850515-1234"), "1985••••-1234");
  });
});

describe("företagskund", () => {
  it("kan skapas utan ROT-fält", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const c = createCustomer({
      kind: "foretag",
      name: "Nord Studio AB",
      orgNumber: "559234-5678",
      contactPerson: "Elin",
      email: "elin@nordstudio.se",
      phone: "070-556 12 40",
    });
    assert.equal(c.kind, "foretag");
    assert.equal(c.workLocations, undefined);
    assert.equal(c.personalIdentityNumber, undefined);
  });
});

describe("personnummer och fastigheter i Ny kund", () => {
  beforeEach(() => {
    replaceDb(emptyTestDb({ customers: [] }));
  });

  it("privat kan skapas utan personnummer och fastighet", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
    });
    assert.equal(c.personalIdentityNumber, undefined);
    assert.equal(c.workLocations, undefined);
  });

  it("privat lagrar normaliserat personnummer", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      personalIdentityNumber: "198505151234",
    });
    assert.equal(c.personalIdentityNumber, "19850515-1234");
  });

  it("privat med en fastighet sätter den som default", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Skövde Aspen 2:14"],
    });
    assert.equal(c.workLocations?.length, 1);
    assert.equal(c.workLocations?.[0].propertyDesignation, "Skövde Aspen 2:14");
    assert.equal(c.workLocations?.[0].label, "Skövde Aspen 2:14");
    assert.equal(c.workLocations?.[0].address, "");
    assert.equal(c.defaultWorkLocationId, c.workLocations?.[0].id);
  });

  it("privat med tre fastigheter, första är default", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Aspen 2:14", "Eken 1:1", "Granen 3:2"],
    });
    assert.equal(c.workLocations?.length, 3);
    assert.equal(c.defaultWorkLocationId, c.workLocations?.[0].id);
    assert.deepEqual(
      c.workLocations?.map((l) => l.propertyDesignation),
      ["Aspen 2:14", "Eken 1:1", "Granen 3:2"]
    );
  });

  it("företag kan ha en eller flera fastigheter men aldrig personnummer", () => {
    const one = createCustomer({
      kind: "foretag",
      name: "Nord Studio AB",
      orgNumber: "559234-5678",
      email: "elin@nordstudio.se",
      phone: "070-556 12 40",
      personalIdentityNumber: "19850515-1234",
      propertyDesignations: ["Aspen 2:14"],
    });
    assert.equal(one.personalIdentityNumber, undefined);
    assert.equal(one.workLocations?.length, 1);

    const many = createCustomer({
      kind: "foretag",
      name: "Bygg AB",
      email: "info@bygg.se",
      phone: "070-000 00 00",
      propertyDesignations: ["A 1:1", "B 2:2"],
    });
    assert.equal(many.personalIdentityNumber, undefined);
    assert.equal(many.workLocations?.length, 2);
  });

  it("tomma fastighetsrader sparas inte", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Aspen 2:14", "", "  "],
    });
    assert.equal(c.workLocations?.length, 1);
    assert.equal(c.workLocations?.[0].propertyDesignation, "Aspen 2:14");
  });

  it("avvisar dubbletter utan att upprepa värdet", () => {
    assert.throws(
      () =>
        createCustomer({
          kind: "privat",
          name: "Lisa Berg",
          email: "lisa@test.se",
          phone: "070-111 22 33",
          propertyDesignations: ["Aspen 2:14", "aspen 2:14"],
        }),
      (error: unknown) => {
        assert.ok(error instanceof CustomerValidationError);
        assert.equal(error.errors[0]?.field, "propertyDesignation");
        assert.equal(error.message.toLowerCase().includes("aspen"), false);
        return true;
      }
    );
  });

  it("redigera lägg till och ta bort fastighet, kvar efter omläsning", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Aspen 2:14"],
    });
    const first = requireCustomer(c.id).workLocations![0];
    syncCustomerProperties(c.id, [
      { id: first.id, designation: "Aspen 2:14" },
      { designation: "Eken 1:1" },
    ]);
    const added = requireCustomer(c.id);
    assert.equal(added.workLocations?.length, 2);
    syncCustomerProperties(c.id, [{ id: first.id, designation: "Aspen 2:14" }]);
    const reloaded = requireCustomer(c.id);
    assert.equal(reloaded.workLocations?.length, 1);
    assert.equal(reloaded.workLocations?.[0].propertyDesignation, "Aspen 2:14");
  });

  it("ändrad beteckning rensar inte adress på rik bostad", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
    });
    const loc = addWorkLocation(c.id, {
      label: "Hem",
      address: "Tantogatan 27",
      postalCode: "118 42",
      city: "Stockholm",
      propertyType: "smahus",
      propertyDesignation: "Södermalm 1:1",
    });
    syncCustomerProperties(c.id, [{ id: loc.id, designation: "Södermalm 1:2" }]);
    const updated = requireCustomer(c.id).workLocations![0];
    assert.equal(updated.address, "Tantogatan 27");
    assert.equal(updated.postalCode, "118 42");
    assert.equal(updated.propertyDesignation, "Södermalm 1:2");
    assert.equal(updated.label, "Hem");
  });

  it("befintliga kunder och sök fungerar, personnummer syns inte i tabellen", () => {
    replaceDb(buildSeed());
    const existing = listCustomersForTable({ q: "Anna" });
    assert.ok(existing.rows.some((row) => row.id === "cust-anna"));
    assert.equal(JSON.stringify(existing.rows).includes("19850515"), false);

    const created = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      personalIdentityNumber: "19850515-1234",
      propertyDesignations: ["Skövde Aspen 2:14"],
    });
    const byDesignation = listCustomersForTable({ q: "aspen" });
    assert.ok(byDesignation.rows.some((row) => row.id === created.id));
    assert.equal(JSON.stringify(byDesignation.rows).includes("19850515"), false);
    assert.equal("personalIdentityNumber" in byDesignation.rows[0], false);
  });

  it("en fastighet prefillar ROT utan uppdrag", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Skövde Aspen 2:14"],
    });
    const prefill = resolveTaxReductionPrefill({ customerId: c.id });
    assert.equal(prefill.housing.dwellingType, "smahus");
    assert.equal(prefill.housing.propertyDesignation, "Skövde Aspen 2:14");
  });

  it("flera fastigheter använder default, inte en slumpad icke-default", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Aspen 2:14", "Eken 1:1", "Granen 3:2"],
    });
    const prefill = resolveTaxReductionPrefill({ customerId: c.id });
    assert.equal(prefill.housing.propertyDesignation, "Aspen 2:14");
    assert.notEqual(prefill.housing.propertyDesignation, "Eken 1:1");
    assert.notEqual(prefill.housing.propertyDesignation, "Granen 3:2");
  });

  it("adress och etikett krävs inte när beteckning finns", () => {
    assert.deepEqual(workLocationFieldErrors({ propertyDesignation: "Aspen 2:14", address: "", label: "" }), []);
    assert.ok(workLocationFieldErrors({ address: "", label: "" }).some((e) => e.field === "address"));
  });

  it("sanitizePropertyDesignations hoppar över tomma och avvisar dubbletter", () => {
    assert.deepEqual(sanitizePropertyDesignations([" Aspen 2:14 ", "", "  "]), ["Aspen 2:14"]);
    assert.throws(
      () => sanitizePropertyDesignations(["Aspen 2:14", "ASPEN 2:14"]),
      (error: unknown) => error instanceof CustomerValidationError && !error.message.toLowerCase().includes("aspen")
    );
  });

  it("hitta bostad på fastighetsbeteckning", () => {
    const c = createCustomer({
      kind: "privat",
      name: "Lisa Berg",
      email: "lisa@test.se",
      phone: "070-111 22 33",
      propertyDesignations: ["Aspen 2:14", "Eken 1:1"],
    });
    assert.equal(findWorkLocationByHint(requireCustomer(c.id), "eken")?.propertyDesignation, "Eken 1:1");
  });
});
