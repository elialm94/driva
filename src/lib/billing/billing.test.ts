process.env.DRIVA_TEST = "1";

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { readStripeConfig, stripeConfigProblems } from "./config";
import { billingAccess, isStaleEvent, mapStripeStatus, patchFromSubscription, type BusinessBilling } from "./state";
import { MemoryBillingStore } from "./store";
import { processStripeEvent } from "./webhook";
import { createCheckoutUrl, createPortalUrl } from "./checkout";
import { BillingError, BillingNotConfiguredError } from "./errors";
import { snapshotFromSubscription, type StripeGateway } from "./stripe";

/**
 * Stripe-abonnemanget: konfiguration, kanoniskt tillstånd och webhooken som
 * sanningskälla.
 *
 * Löftena som testas: utan komplett konfiguration finns inget abonnemang att
 * simulera; provperioden ger skrivskydd exakt när den tar slut; checkout
 * aktiverar aldrig något själv; samma händelse skriver bara en gång; en
 * äldre händelse rullar aldrig tillbaka en nyare; betalningsfel ger grace i
 * stället för utelåsning; uppsägning gäller till periodens slut.
 */

const ENV_OK = {
  STRIPE_SECRET_KEY: "sk_test_abc123",
  STRIPE_WEBHOOK_SECRET: "whsec_testsecret",
  STRIPE_PRICE_ID: "price_123",
  NODE_ENV: "test",
};

const NOW = new Date("2026-09-12T10:00:00Z");
const BIZ = "11111111-1111-4111-8111-111111111111";

function trialBusiness(over: Partial<BusinessBilling> = {}): BusinessBilling {
  return {
    businessId: BIZ,
    isDemo: false,
    trialStartedAt: "2026-09-01T10:00:00Z",
    trialEndsAt: "2026-09-15T10:00:00Z",
    subscriptionStatus: "trialing",
    cancelAtPeriodEnd: false,
    ...over,
  };
}

/* ------------------------------ Konfiguration ------------------------------ */

describe("Stripe-konfigurationen", () => {
  it("är komplett bara med nyckel, webhook-hemlighet och pris-id i rätt format", () => {
    assert.deepEqual(stripeConfigProblems(ENV_OK), []);
    const cfg = readStripeConfig(ENV_OK);
    assert.ok(cfg);
    assert.equal(cfg.mode, "test");
    assert.equal(cfg.priceId, "price_123");
  });

  it("säger exakt vad som saknas, utan att läcka värden", () => {
    const problems = stripeConfigProblems({ STRIPE_SECRET_KEY: "sk_test_x", STRIPE_PRICE_ID: "prod_123" });
    assert.ok(problems.some((p) => p.includes("STRIPE_WEBHOOK_SECRET saknas")));
    assert.ok(problems.some((p) => p.includes("pris-id")));
    assert.ok(!problems.some((p) => p.includes("sk_test_x")));
    assert.equal(readStripeConfig({}), null);
  });

  it("vägrar blanda test- och live-nycklar", () => {
    const problems = stripeConfigProblems({ ...ENV_OK, STRIPE_PUBLISHABLE_KEY: "pk_live_zzz" });
    assert.ok(problems.some((p) => p.includes("live-läge") && p.includes("test-läge")));
  });

  it("varnar för live-nyckel utanför produktion", () => {
    const problems = stripeConfigProblems({ ...ENV_OK, STRIPE_SECRET_KEY: "sk_live_abc", NODE_ENV: "development" });
    assert.ok(problems.some((p) => p.includes("Live-nyckel utanför produktion")));
    assert.deepEqual(stripeConfigProblems({ ...ENV_OK, STRIPE_SECRET_KEY: "sk_live_abc", NODE_ENV: "production" }), []);
  });
});

/* ------------------------------- Tillståndet -------------------------------- */

describe("kanoniskt tillstånd och åtkomst", () => {
  it("mappar Stripes status; incomplete ändrar ingenting", () => {
    assert.equal(mapStripeStatus("trialing"), "trialing");
    assert.equal(mapStripeStatus("active"), "active");
    assert.equal(mapStripeStatus("past_due"), "past_due");
    assert.equal(mapStripeStatus("canceled"), "canceled");
    assert.equal(mapStripeStatus("unpaid"), "expired");
    assert.equal(mapStripeStatus("paused"), "expired");
    assert.equal(mapStripeStatus("incomplete"), null);
    assert.equal(mapStripeStatus("incomplete_expired"), null);
  });

  it("provperioden ger full åtkomst med dagar kvar och blir skrivskyddad när den tagit slut", () => {
    const during = billingAccess(trialBusiness(), NOW);
    assert.equal(during.mode, "full");
    assert.equal(during.reason, "trial");
    assert.equal(during.trialDaysLeft, 3);
    assert.match(during.message, /3 dagar kvar/);

    const after = billingAccess(trialBusiness(), new Date("2026-09-16T00:00:00Z"));
    assert.equal(after.mode, "read_only");
    assert.equal(after.reason, "trial_expired");
    assert.match(after.message, /läsa och exportera/);
  });

  it("demoföretag och företag utan provperiod låses aldrig ute", () => {
    assert.equal(billingAccess(trialBusiness({ isDemo: true, trialEndsAt: "2020-01-01T00:00:00Z" }), NOW).mode, "full");
    assert.equal(billingAccess(trialBusiness({ subscriptionStatus: null, trialEndsAt: undefined }), NOW).reason, "legacy");
  });

  it("aktivt abonnemang är öppet; uppsagt gäller till periodens slut; utgånget är skrivskyddat", () => {
    const active = billingAccess(
      trialBusiness({ subscriptionStatus: "active", stripeSubscriptionId: "sub_1", currentPeriodEnd: "2026-10-12T10:00:00Z" }),
      NOW
    );
    assert.equal(active.reason, "active");

    const scheduled = billingAccess(
      trialBusiness({
        subscriptionStatus: "active",
        stripeSubscriptionId: "sub_1",
        currentPeriodEnd: "2026-10-12T10:00:00Z",
        cancelAtPeriodEnd: true,
      }),
      NOW
    );
    assert.equal(scheduled.mode, "full");
    assert.equal(scheduled.reason, "cancel_scheduled");
    assert.match(scheduled.message, /12 oktober 2026/);

    const canceledFuture = billingAccess(
      trialBusiness({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_1", currentPeriodEnd: "2026-10-12T10:00:00Z" }),
      NOW
    );
    assert.equal(canceledFuture.mode, "full");

    const canceledPast = billingAccess(
      trialBusiness({ subscriptionStatus: "canceled", stripeSubscriptionId: "sub_1", currentPeriodEnd: "2026-09-01T10:00:00Z" }),
      NOW
    );
    assert.equal(canceledPast.mode, "read_only");
    assert.equal(canceledPast.reason, "canceled");

    assert.equal(billingAccess(trialBusiness({ subscriptionStatus: "expired" }), NOW).mode, "read_only");
  });

  it("betalningsfel är grace: full åtkomst med tydlig status", () => {
    const grace = billingAccess(trialBusiness({ subscriptionStatus: "past_due", stripeSubscriptionId: "sub_1" }), NOW);
    assert.equal(grace.mode, "full");
    assert.equal(grace.reason, "grace");
    assert.match(grace.message, /kundportalen/);
  });

  it("en äldre händelse än den senast skrivna är inaktuell", () => {
    assert.equal(isStaleEvent(trialBusiness({ billingEventCreated: 1000 }), 999), true);
    assert.equal(isStaleEvent(trialBusiness({ billingEventCreated: 1000 }), 1000), false);
    assert.equal(isStaleEvent(trialBusiness(), 5), false);
  });

  it("läser periodslutet från abonnemangsraden (Dahlia) och faller tillbaka på det gamla fältet", () => {
    const modern = snapshotFromSubscription({
      id: "sub_1",
      customer: "cus_1",
      status: "active",
      cancel_at_period_end: false,
      metadata: { businessId: BIZ },
      items: { data: [{ current_period_end: 1_800_000_000, price: { id: "price_123" } }] },
    } as unknown as Stripe.Subscription);
    assert.equal(modern.currentPeriodEnd, new Date(1_800_000_000 * 1000).toISOString());
    assert.equal(modern.priceId, "price_123");
    assert.equal(modern.metadataBusinessId, BIZ);

    const legacy = snapshotFromSubscription({
      id: "sub_2",
      customer: { id: "cus_2" },
      status: "trialing",
      cancel_at_period_end: true,
      current_period_end: 1_700_000_000,
      items: { data: [] },
    } as unknown as Stripe.Subscription);
    assert.equal(legacy.customerId, "cus_2");
    assert.equal(legacy.currentPeriodEnd, new Date(1_700_000_000 * 1000).toISOString());
    assert.equal(legacy.cancelAtPeriodEnd, true);
  });
});

/* --------------------------------- Webhooken -------------------------------- */

function subscriptionObject(over: Record<string, unknown> = {}) {
  return {
    object: "subscription",
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    metadata: { businessId: BIZ },
    items: { data: [{ current_period_end: 1_790_000_000, price: { id: "price_123" } }] },
    ...over,
  };
}

function event(type: string, object: unknown, over: { id?: string; created?: number } = {}): Stripe.Event {
  return {
    id: over.id ?? `evt_${Math.random().toString(36).slice(2)}`,
    object: "event",
    api_version: "2026-08-26.dahlia",
    created: over.created ?? 1_760_000_000,
    livemode: false,
    pending_webhooks: 1,
    request: null,
    type,
    data: { object },
  } as unknown as Stripe.Event;
}

function gatewayReturning(subs: Record<string, Record<string, unknown>>): Pick<StripeGateway, "retrieveSubscription"> {
  return {
    async retrieveSubscription(id) {
      const sub = subs[id];
      if (!sub) throw new Error(`No such subscription: ${id}`);
      return snapshotFromSubscription(sub as unknown as Stripe.Subscription);
    },
  };
}

describe("webhooken som sanningskälla", () => {
  let store: MemoryBillingStore;
  beforeEach(() => {
    store = new MemoryBillingStore();
    store.seed(trialBusiness());
  });

  it("checkout.session.completed kopplar kunden och skriver abonnemanget som Stripe har det – inte som sessionen påstår", async () => {
    const gateway = gatewayReturning({ sub_1: subscriptionObject({ status: "trialing" }) });
    const outcome = await processStripeEvent(
      { store, gateway },
      event("checkout.session.completed", {
        object: "checkout.session",
        mode: "subscription",
        client_reference_id: BIZ,
        customer: "cus_1",
        subscription: "sub_1",
        payment_status: "paid",
      })
    );
    assert.equal(outcome.kind, "processed");
    const b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.stripeCustomerId, "cus_1");
    assert.equal(b.stripeSubscriptionId, "sub_1");
    assert.equal(b.stripeStatus, "trialing", "status från Stripe, inte 'paid' från sessionen");
    assert.equal(b.subscriptionStatus, "trialing");
  });

  it("customer.subscription.updated aktiverar; samma event-id skriver bara en gång", async () => {
    const gateway = gatewayReturning({});
    const e = event("customer.subscription.updated", subscriptionObject(), { id: "evt_same", created: 100 });
    assert.equal((await processStripeEvent({ store, gateway }, e)).kind, "processed");
    const again = await processStripeEvent({ store, gateway }, e);
    assert.equal(again.kind, "duplicate");
    const b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.subscriptionStatus, "active");
    assert.equal(b.stripePriceId, "price_123");
    assert.equal(b.billingEventCreated, 100);
    assert.equal(store.events.size, 1);
    assert.equal([...store.events.values()][0].status, "bearbetad");
  });

  it("en äldre händelse som kommer efter en nyare ignoreras", async () => {
    const gateway = gatewayReturning({});
    await processStripeEvent({ store, gateway }, event("customer.subscription.updated", subscriptionObject({ status: "active" }), { created: 200 }));
    const late = await processStripeEvent(
      { store, gateway },
      event("customer.subscription.updated", subscriptionObject({ status: "trialing" }), { created: 150 })
    );
    assert.equal(late.kind, "ignored");
    assert.equal((await store.billingForBusiness(BIZ))!.subscriptionStatus, "active");
  });

  it("invoice.payment_failed läser om abonnemanget → past_due (grace), invoice.paid → active igen", async () => {
    const subs: Record<string, Record<string, unknown>> = { sub_1: subscriptionObject({ status: "past_due" }) };
    const gateway = gatewayReturning(subs);
    const invoice = {
      object: "invoice",
      id: "in_1",
      customer: "cus_1",
      parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { businessId: BIZ } } },
    };
    await processStripeEvent({ store, gateway }, event("invoice.payment_failed", invoice, { created: 300 }));
    let b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.subscriptionStatus, "past_due");
    assert.equal(billingAccess(b, NOW).mode, "full", "grace – ingen utelåsning");

    subs.sub_1 = subscriptionObject({ status: "active" });
    await processStripeEvent({ store, gateway }, event("invoice.paid", invoice, { created: 301 }));
    b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.subscriptionStatus, "active");
  });

  it("customer.subscription.deleted → canceled; åtkomsten följer periodens slut", async () => {
    const gateway = gatewayReturning({});
    await processStripeEvent({ store, gateway }, event("customer.subscription.updated", subscriptionObject(), { created: 400 }));
    await processStripeEvent(
      { store, gateway },
      event("customer.subscription.deleted", subscriptionObject({ status: "canceled", cancel_at_period_end: true }), { created: 401 })
    );
    const b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.subscriptionStatus, "canceled");
    assert.equal(b.stripeStatus, "canceled");
    assert.equal(b.cancelAtPeriodEnd, false, "raderat abonnemang har inget 'gäller till' kvar");
    assert.equal(billingAccess(b, new Date("2030-01-01T00:00:00Z")).mode, "read_only");
  });

  it("uppsägning via kundportalen: cancel_at_period_end sparas och företaget arbetar vidare till periodens slut", async () => {
    const gateway = gatewayReturning({});
    await processStripeEvent(
      { store, gateway },
      event("customer.subscription.updated", subscriptionObject({ cancel_at_period_end: true }), { created: 500 })
    );
    const b = (await store.billingForBusiness(BIZ))!;
    assert.equal(b.cancelAtPeriodEnd, true);
    const access = billingAccess(b, NOW);
    assert.equal(access.mode, "full");
    assert.equal(access.reason, "cancel_scheduled");
  });

  it("händelser utan matchande företag och okända typer ignoreras men loggas", async () => {
    const gateway = gatewayReturning({});
    const unknownBiz = await processStripeEvent(
      { store, gateway },
      event("customer.subscription.updated", subscriptionObject({ customer: "cus_other", metadata: {} }))
    );
    assert.equal(unknownBiz.kind, "ignored");
    const other = await processStripeEvent({ store, gateway }, event("charge.succeeded", { object: "charge" }));
    assert.equal(other.kind, "ignored");
    assert.equal(store.events.size, 2);
    assert.ok([...store.events.values()].every((e) => e.status === "ignorerad"));
    assert.equal((await store.billingForBusiness(BIZ))!.subscriptionStatus, "trialing");
  });

  it("demoföretag berörs aldrig", async () => {
    store.seed(trialBusiness({ businessId: "demo-1", isDemo: true, stripeCustomerId: "cus_demo" }));
    const outcome = await processStripeEvent(
      { store, gateway: gatewayReturning({}) },
      event("customer.subscription.updated", subscriptionObject({ customer: "cus_demo", metadata: {} }))
    );
    assert.equal(outcome.kind, "ignored");
  });

  it("ett fel under bearbetningen loggas sanerat och händelsen märks fel", async () => {
    const gateway: Pick<StripeGateway, "retrieveSubscription"> = {
      async retrieveSubscription() {
        throw new Error("Stripe nere sk_test_leak");
      },
    };
    const outcome = await processStripeEvent(
      { store, gateway },
      event("checkout.session.completed", { object: "checkout.session", mode: "subscription", client_reference_id: BIZ, customer: "cus_1", subscription: "sub_1" })
    );
    assert.equal(outcome.kind, "failed");
    const row = [...store.events.values()][0];
    assert.equal(row.status, "fel");
    assert.ok(row.error && !row.error.includes("sk_test_leak"));
  });

  it("verifierar Stripe-Signature mot den råa kroppen med SDK:n", async () => {
    const stripe = new Stripe("sk_test_dummy");
    const payload = JSON.stringify(event("customer.subscription.updated", subscriptionObject(), { id: "evt_sig" }));
    const header = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_testsecret" });
    const ok = await stripe.webhooks.constructEventAsync(payload, header, "whsec_testsecret");
    assert.equal(ok.id, "evt_sig");
    await assert.rejects(stripe.webhooks.constructEventAsync(payload, header, "whsec_wrong"));
    await assert.rejects(stripe.webhooks.constructEventAsync(payload.replace("sub_1", "sub_9"), header, "whsec_testsecret"));
  });
});

/* -------------------------------- Checkout ---------------------------------- */

describe("Checkout och kundportal", () => {
  const ctx = { businessId: BIZ, businessName: "Snickare Svensson AB", orgNumber: "556677-8899", email: "anna@exempel.se", origin: "https://app.ferva.se/" };

  function fakeGateway(calls: string[]): StripeGateway {
    return {
      async retrieveSubscription() {
        throw new Error("not used");
      },
      async createCustomer(input) {
        calls.push(`customer:${input.businessId}:${input.email}`);
        return "cus_new";
      },
      async createCheckoutSession(input) {
        calls.push(`checkout:${input.customerId}:${input.priceId}:${input.businessId}:${input.successUrl}`);
        return { url: "https://checkout.stripe.com/c/pay/cs_test" };
      },
      async createPortalSession(input) {
        calls.push(`portal:${input.customerId}:${input.returnUrl}`);
        return { url: "https://billing.stripe.com/p/session/x" };
      },
      async constructEvent() {
        throw new Error("not used");
      },
    };
  }

  it("utan konfiguration finns ingen checkout – ärligt fel, inget låtsasabonnemang", async () => {
    const store = new MemoryBillingStore();
    store.seed(trialBusiness());
    await assert.rejects(createCheckoutUrl(ctx, { store, gateway: fakeGateway([]), env: {} }), BillingNotConfiguredError);
    await assert.rejects(createPortalUrl(ctx, { store, gateway: fakeGateway([]), env: {} }), BillingNotConfiguredError);
  });

  it("skapar kunden server-side, sparar kund-id och skickar tenantens id som client_reference_id", async () => {
    const store = new MemoryBillingStore();
    store.seed(trialBusiness());
    const calls: string[] = [];
    const url = await createCheckoutUrl(ctx, { store, gateway: fakeGateway(calls), env: ENV_OK });
    assert.match(url, /^https:\/\/checkout\.stripe\.com\//);
    assert.equal(calls[0], `customer:${BIZ}:anna@exempel.se`);
    assert.equal(calls[1], `checkout:cus_new:price_123:${BIZ}:https://app.ferva.se/installningar?flik=konto&checkout=klart`);
    assert.equal((await store.billingForBusiness(BIZ))!.stripeCustomerId, "cus_new");
    assert.equal((await store.billingForBusiness(BIZ))!.subscriptionStatus, "trialing", "checkout aktiverar inget");
  });

  it("återanvänder befintlig kund och vägrar dubbla abonnemang", async () => {
    const store = new MemoryBillingStore();
    store.seed(trialBusiness({ stripeCustomerId: "cus_old" }));
    const calls: string[] = [];
    await createCheckoutUrl(ctx, { store, gateway: fakeGateway(calls), env: ENV_OK });
    assert.ok(calls[0].startsWith("checkout:cus_old:"), "ingen ny kund skapas");

    store.seed(trialBusiness({ stripeCustomerId: "cus_old", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }));
    await assert.rejects(createCheckoutUrl(ctx, { store, gateway: fakeGateway([]), env: ENV_OK }), BillingError);
  });

  it("kundportalen kräver en Stripe-kund och pekar tillbaka till Konto", async () => {
    const store = new MemoryBillingStore();
    store.seed(trialBusiness());
    await assert.rejects(createPortalUrl(ctx, { store, gateway: fakeGateway([]), env: ENV_OK }), BillingError);
    store.seed(trialBusiness({ stripeCustomerId: "cus_1", stripeSubscriptionId: "sub_1", subscriptionStatus: "active" }));
    const calls: string[] = [];
    const url = await createPortalUrl(ctx, { store, gateway: fakeGateway(calls), env: ENV_OK });
    assert.match(url, /billing\.stripe\.com/);
    assert.equal(calls[0], "portal:cus_1:https://app.ferva.se/installningar?flik=konto");
  });

  it("demoföretag kan varken teckna eller öppna portalen", async () => {
    const store = new MemoryBillingStore();
    store.seed(trialBusiness({ isDemo: true }));
    await assert.rejects(createCheckoutUrl(ctx, { store, gateway: fakeGateway([]), env: ENV_OK }), BillingError);
  });

  it("patchen ur ett abonnemang bär allt raden behöver", () => {
    const patch = patchFromSubscription(
      { id: "sub_1", customerId: "cus_1", status: "active", priceId: "price_123", currentPeriodEnd: "2026-10-01T00:00:00.000Z", cancelAtPeriodEnd: false },
      42
    );
    assert.equal(patch.subscriptionStatus, "active");
    assert.equal(patch.eventCreated, 42);
    assert.equal(patchFromSubscription({ id: "sub_1", status: "incomplete", cancelAtPeriodEnd: false }, 1).subscriptionStatus, null);
  });
});
