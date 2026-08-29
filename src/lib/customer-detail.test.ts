process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { replaceDb, db } from "./store";
import { buildSeed } from "./seed";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import { createCustomer, listCustomersForTable, updateCustomer } from "./services/customers";
import { addWorkLocation, findWorkLocationByHint, setCustomerPersonnummer, workLocationsForModel } from "./services/work-locations";
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
    assert.ok(rows.some((r) => r.kind === "faktura" && r.href.includes("/ekonomi/fakturor/")));
    assert.ok(rows.some((r) => r.kind === "offert" && r.href.includes("/ekonomi/offerter/")));
    assert.ok(rows.some((r) => r.kind === "uppdrag" && r.href.includes("/uppdrag/")));
    assert.ok(rows.some((r) => r.kind === "betalning"));
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
