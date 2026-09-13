/**
 * Checkout- och kundportalsessioner skapas server-side för det aktuella
 * företaget. Kund-id:t hämtas ur företagsraden eller skapas här – aldrig från
 * klienten. Checkout-success aktiverar inget; webhooken gör det.
 */
import { legalEntityStatus } from "../legal/entity";
import { BillingError, BillingNotConfiguredError } from "./errors";
import { readStripeConfig } from "./config";
import { billingAccess } from "./state";
import { billingStore, type BillingStore } from "./store";
import { stripeGateway, type StripeGateway } from "./stripe";

export interface CheckoutContext {
  businessId: string;
  businessName: string;
  orgNumber?: string;
  email?: string;
  /** Absolut app-adress (https://app…) för retur-URL:er. */
  origin: string;
}

export const BILLING_RETURN_PATH = "/installningar?flik=konto";

export const LEGAL_ENTITY_MISSING_MESSAGE =
  "Abonnemang kan inte tecknas ännu: Fervas avtalsuppgifter (avtalspart, organisationsnummer, adress, kontakt) är inte konfigurerade i den här miljön.";

interface Deps {
  store?: BillingStore;
  gateway?: StripeGateway;
  env?: Record<string, string | undefined>;
}

async function ensureCustomer(ctx: CheckoutContext, store: BillingStore, gateway: StripeGateway): Promise<string> {
  const billing = await store.billingForBusiness(ctx.businessId);
  if (!billing) throw new BillingError("Företaget hittades inte.");
  if (billing.isDemo) throw new BillingError("Demoföretag kan inte teckna abonnemang.");
  if (billing.stripeCustomerId) return billing.stripeCustomerId;
  const customerId = await gateway.createCustomer({
    businessId: ctx.businessId,
    email: ctx.email,
    name: ctx.businessName,
    orgNumber: ctx.orgNumber,
  });
  await store.linkStripeCustomer(ctx.businessId, customerId);
  return customerId;
}

/** Adress till Stripe Checkout för Ferva-planen. */
export async function createCheckoutUrl(ctx: CheckoutContext, deps: Deps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  const config = readStripeConfig(env);
  if (!config) throw new BillingNotConfiguredError();
  // Ingen får teckna ett avtal med en avtalspart som inte finns (spec §7).
  if (!legalEntityStatus(env).complete) throw new BillingError(LEGAL_ENTITY_MISSING_MESSAGE);
  const store = deps.store ?? billingStore();
  const gateway = deps.gateway ?? stripeGateway(env);

  const billing = await store.billingForBusiness(ctx.businessId);
  if (!billing) throw new BillingError("Företaget hittades inte.");
  const access = billingAccess(billing);
  if (billing.stripeSubscriptionId && (access.reason === "active" || access.reason === "grace" || access.reason === "cancel_scheduled")) {
    throw new BillingError("Företaget har redan ett abonnemang. Hantera det i kundportalen.");
  }

  const customerId = await ensureCustomer(ctx, store, gateway);
  const base = `${ctx.origin.replace(/\/$/, "")}${BILLING_RETURN_PATH}`;
  const { url } = await gateway.createCheckoutSession({
    customerId,
    priceId: config.priceId,
    businessId: ctx.businessId,
    successUrl: `${base}&checkout=klart`,
    cancelUrl: `${base}&checkout=avbrutet`,
  });
  return url;
}

/** Adress till Stripe Customer Portal (byta kort, säga upp, kvitton). */
export async function createPortalUrl(ctx: CheckoutContext, deps: Deps = {}): Promise<string> {
  const env = deps.env ?? process.env;
  if (!readStripeConfig(env)) throw new BillingNotConfiguredError();
  const store = deps.store ?? billingStore();
  const gateway = deps.gateway ?? stripeGateway(env);
  const billing = await store.billingForBusiness(ctx.businessId);
  if (!billing) throw new BillingError("Företaget hittades inte.");
  if (billing.isDemo) throw new BillingError("Demoföretag har ingen kundportal.");
  if (!billing.stripeCustomerId) {
    throw new BillingError("Företaget har ingen Stripe-kund ännu. Starta abonnemanget först.");
  }
  const { url } = await gateway.createPortalSession({
    customerId: billing.stripeCustomerId,
    returnUrl: `${ctx.origin.replace(/\/$/, "")}${BILLING_RETURN_PATH}`,
  });
  return url;
}
