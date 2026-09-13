process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { db, replaceDb, save } from "./store";
import { buildSeed } from "./seed";
import { cloneState, runInTenantContext, type TenantContext } from "./storage/context";
import { createCustomer } from "./services/customers";
import { createInvoice } from "./services/invoices";
import { getInvoiceSendBlockers } from "./invoices/validate";
import { emptyTestDb, labor, testCustomer } from "./invoices/test-db";
import {
  currentVersion,
  getQuote,
  pendingDraftQuoteVersion,
  quoteAcceptance,
  quoteTotals,
  quoteVersions,
  requireCustomer,
} from "./services/data";
import { documentLinkView } from "./services/document-job-link";
import {
  createQuote,
  isQuoteContactSoftBlocker,
  quoteDefaults,
  quoteHardSendBlockers,
  quoteSendBlockers,
  updateQuote,
} from "./services/quotes";
import { addWorkLocation, setCustomerPersonnummer } from "./services/work-locations";
import { quoteHasSendDestination, quoteSendButtonEnabled } from "./quote-send-contact";

function readCtx(): TenantContext {
  const state = db();
  return {
    businessId: "biz-page",
    userId: "user-page",
    writable: false,
    state,
    baseline: cloneState(state),
    stateVersion: 1,
    dirty: false,
  };
}

function writeCtx(): TenantContext {
  return { ...readCtx(), writable: true };
}

/** Samma läsningar som offertsides RSC gör efter ensurePageBusiness. */
function loadQuotePageReads(quoteId: string) {
  const quote = getQuote(quoteId);
  assert.ok(quote, quoteId);
  const data = db();
  currentVersion(quote);
  requireCustomer(quote.customerId);
  quoteAcceptance(quote.id);
  quoteTotals(quote);
  quoteVersions(quote.id);
  pendingDraftQuoteVersion(quote);
  documentLinkView("quote", quote.id, { href: `/ekonomi/offerter/${quote.id}`, label: `Offert #${quote.number}` });
  data.invoices.filter((invoice) => invoice.quoteId === quote.id);
  const sendBlockers = quoteSendBlockers(quote.id).filter((blocker) => !isQuoteContactSoftBlocker(blocker.code));
  const hard = quoteHardSendBlockers(quote.id);
  assert.deepEqual(
    sendBlockers.map((blocker) => blocker.code),
    hard.map((blocker) => blocker.code),
  );
  return { quote, sendBlockers, hard };
}

describe("ensurePageBusiness binder request-cellen utanför cache()", () => {
  it("sidoladdningen skriver bindRequestTenant efter den cachade loadern", () => {
    const session = readFileSync(new URL("./auth/session.ts", import.meta.url), "utf8");
    assert.match(session, /bindRequestTenant\(await loadDemoPage/);
    assert.match(session, /bindRequestTenant\(await loadPageBusiness/);
    assert.match(session, /bindRequestTenant\(await loadDemoPublicPage/);
    assert.match(session, /bindRequestTenant\(loaded\)/);
    assert.doesNotMatch(session, /const slot = requestSlot\(\);\s*slot\.state =/);
  });

  it("db() speglar tenantkontext till bindRequestTenant", () => {
    const store = readFileSync(new URL("./store.ts", import.meta.url), "utf8");
    assert.match(store, /bindRequestTenant\(\{ state: ctx\.state, businessId: ctx\.businessId \}\)/);
  });

  it("createQuoteAction revaliderar efter withBusiness, inte inuti", () => {
    const actions = readFileSync(new URL("../app/actions.ts", import.meta.url), "utf8");
    const start = actions.indexOf("export async function createQuoteAction");
    const end = actions.indexOf("export async function updateQuoteAction");
    assert.ok(start >= 0 && end > start);
    const fn = actions.slice(start, end);
    assert.match(fn, /await withBusiness\(\(\) => createQuote\(input\)\.id/);
    assert.match(fn, /refresh\(\)/);
    assert.match(fn, /redirect\(/);
    assert.ok(
      fn.indexOf("refresh()") > fn.indexOf("createQuote(input).id"),
      "refresh() måste ligga efter withBusiness-anropet",
    );
  });
});

describe("offert #116 quote-bokhylla: spara utkast utan error boundary", () => {
  beforeEach(() => {
    replaceDb(buildSeed());
  });

  it("sidans läsningar kastar inte i läskontext, och save() är förbjudet", () => {
    const { sendBlockers } = runInTenantContext(readCtx(), () => loadQuotePageReads("quote-bokhylla"));
    assert.ok(sendBlockers.some((blocker) => blocker.code === "personnummer"));
    assert.ok(sendBlockers.some((blocker) => blocker.code === "property"));
    assert.ok(!sendBlockers.some((blocker) => blocker.code === "buyer_email"));

    assert.throws(
      () => runInTenantContext(readCtx(), () => save()),
      /läskontext/,
    );
  });

  it("efter personnummer + bostad + draft-save: sidan håller, kanalvalet är tillgängligt", () => {
    runInTenantContext(writeCtx(), () => {
      setCustomerPersonnummer("cust-eva", "19991231-9999");
      const location = addWorkLocation("cust-eva", {
        label: "Vardagsrummet",
        address: "Sickla Kanalgata 43",
        postalCode: "120 67",
        city: "Stockholm",
        propertyType: "smahus",
      });
      const quote = getQuote("quote-bokhylla");
      assert.ok(quote);
      const version = currentVersion(quote);
      updateQuote(quote.id, {
        title: version.title,
        lines: version.lines,
        rot: version.rot,
        paymentPlan: version.paymentPlan,
        paymentTermsDays: version.paymentTermsDays,
        validUntil: version.validUntil,
        terms: version.terms,
        workLocationId: location.id,
      });
    });

    const { quote, sendBlockers } = runInTenantContext(readCtx(), () => loadQuotePageReads("quote-bokhylla"));
    assert.equal(sendBlockers.length, 0);
    const customer = requireCustomer(quote.customerId);
    assert.equal(quoteHasSendDestination(customer), true);
    assert.equal(
      quoteSendButtonEnabled({ hardBlockers: sendBlockers.length, email: customer.email, phone: customer.phone }),
      true,
    );
  });
});

describe("ny offert utan ROT (/ekonomi/offerter/ny): skapa och landa utan krasch", () => {
  beforeEach(() => {
    replaceDb(buildSeed());
  });

  it("ny-sidans läsningar kastar inte i läskontext", () => {
    runInTenantContext(readCtx(), () => {
      quoteDefaults();
      const customers = [...db().customers].sort((a, b) => a.name.localeCompare(b.name, "sv"));
      assert.ok(customers.length > 0);
    });
  });

  it("efter create av icke-ROT-utkast: detaljsidans läsningar kastar inte, och save() är förbjudet", () => {
    const created = runInTenantContext(writeCtx(), () => {
      const defaults = quoteDefaults();
      return createQuote({
        customerId: "cust-eva",
        title: "Hyllplan utan ROT",
        lines: [labor({ unitPrice: 2_000 })],
        rot: null,
        paymentPlan: [{ label: "När arbetet är klart", percent: 100 }],
        paymentTermsDays: defaults.paymentTermsDays,
        validUntil: defaults.validUntil,
        terms: defaults.terms,
      });
    });

    const { quote, sendBlockers } = runInTenantContext(readCtx(), () => loadQuotePageReads(created.id));
    assert.equal(quote.status, "utkast");
    assert.equal(currentVersion(quote).rot, null);
    assert.ok(!sendBlockers.some((blocker) => blocker.code === "personnummer"));
    assert.ok(!sendBlockers.some((blocker) => blocker.code === "property"));
    const customer = requireCustomer(quote.customerId);
    assert.equal(quoteHasSendDestination(customer), true);
    assert.equal(sendBlockers.length, 0);
    assert.equal(
      quoteSendButtonEnabled({ hardBlockers: 0, email: customer.email, phone: customer.phone }),
      true,
    );
    assert.throws(
      () => runInTenantContext(readCtx(), () => save()),
      /läskontext/,
    );
  });
});

describe("ny kund utan e-post och fakturans hårda e-postkrav", () => {
  it("skapar kund med telefon och tom e-post – ingen valideringskrasch", () => {
    replaceDb(emptyTestDb({ customers: [] }));
    const created = createCustomer({
      kind: "privat",
      name: "Invoice blocker retry",
      phone: "0707654321",
      email: "",
    });
    assert.equal(created.phone.length > 0, true);
    assert.equal(created.email, "");
    assert.ok(db().customers.some((customer) => customer.id === created.id));
  });

  it("faktura utan buyer_email är fortfarande hård send-blocker med Lägg till e-post", () => {
    replaceDb(
      emptyTestDb({
        customers: [testCustomer({ id: "cust-1", email: "", phone: "0707654321" })],
      }),
    );
    const invoice = createInvoice({
      customerId: "cust-1",
      type: "faktura",
      lines: [labor({ unitPrice: 2_000 })],
      rot: null,
    });
    const blockers = getInvoiceSendBlockers(invoice.id);
    const email = blockers.find((blocker) => blocker.code === "buyer_email");
    assert.ok(email, "invoice-send-blockers måste fortfarande kräva e-post");
    assert.equal(email.actionLabel, "Lägg till e-post");
    assert.equal(email.href, `/kunder/${invoice.customerId}#kund-epost`);
  });
});
