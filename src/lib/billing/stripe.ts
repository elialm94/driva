/**
 * Stripe-klienten (officiella SDK:n) bakom ett smalt gränssnitt så att
 * webhook- och checkoutlogiken kan testas utan nätverk. Server-only: den
 * hemliga nyckeln läses bara här och når aldrig en klientkomponent.
 */
import Stripe from "stripe";
import { BillingNotConfiguredError } from "./errors";
import { readStripeConfig, type StripeConfig } from "./config";
import type { SubscriptionSnapshot } from "./state";

export interface CheckoutInput {
  customerId: string;
  priceId: string;
  businessId: string;
  successUrl: string;
  cancelUrl: string;
}

export interface StripeGateway {
  retrieveSubscription(id: string): Promise<SubscriptionSnapshot>;
  createCustomer(input: { businessId: string; email?: string; name: string; orgNumber?: string }): Promise<string>;
  createCheckoutSession(input: CheckoutInput): Promise<{ url: string }>;
  createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;
  constructEvent(rawBody: string, signature: string): Promise<Stripe.Event>;
}

/** Stripes abonnemangsobjekt → det lilla vi behöver. Tål äldre API-versioner. */
export function snapshotFromSubscription(sub: Stripe.Subscription): SubscriptionSnapshot {
  const item = sub.items?.data?.[0];
  const legacyEnd = (sub as unknown as { current_period_end?: number }).current_period_end;
  const end = item?.current_period_end ?? legacyEnd;
  return {
    id: sub.id,
    customerId: typeof sub.customer === "string" ? sub.customer : sub.customer?.id,
    status: sub.status,
    priceId: item?.price?.id,
    currentPeriodEnd: end ? new Date(end * 1000).toISOString() : undefined,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    metadataBusinessId: sub.metadata?.businessId || undefined,
  };
}

class LiveStripeGateway implements StripeGateway {
  private readonly stripe: Stripe;
  constructor(private readonly config: StripeConfig) {
    this.stripe = new Stripe(config.secretKey, {
      appInfo: { name: "Ferva", url: "https://ferva.se" },
      maxNetworkRetries: 2,
      timeout: 20_000,
    });
  }

  async retrieveSubscription(id: string): Promise<SubscriptionSnapshot> {
    const sub = await this.stripe.subscriptions.retrieve(id);
    return snapshotFromSubscription(sub);
  }

  async createCustomer(input: { businessId: string; email?: string; name: string; orgNumber?: string }): Promise<string> {
    const customer = await this.stripe.customers.create(
      {
        email: input.email,
        name: input.name,
        metadata: { businessId: input.businessId, ...(input.orgNumber ? { orgNumber: input.orgNumber } : {}) },
        preferred_locales: ["sv"],
      },
      { idempotencyKey: `ferva-customer-${input.businessId}` }
    );
    return customer.id;
  }

  async createCheckoutSession(input: CheckoutInput): Promise<{ url: string }> {
    const session = await this.stripe.checkout.sessions.create({
      mode: "subscription",
      customer: input.customerId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      client_reference_id: input.businessId,
      locale: "sv",
      allow_promotion_codes: false,
      billing_address_collection: "required",
      tax_id_collection: { enabled: true },
      customer_update: { address: "auto", name: "auto" },
      metadata: { businessId: input.businessId },
      subscription_data: { metadata: { businessId: input.businessId } },
    });
    if (!session.url) throw new Error("Stripe returnerade ingen Checkout-adress.");
    return { url: session.url };
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: input.customerId,
      return_url: input.returnUrl,
      locale: "sv",
    });
    return { url: session.url };
  }

  async constructEvent(rawBody: string, signature: string): Promise<Stripe.Event> {
    return this.stripe.webhooks.constructEventAsync(rawBody, signature, this.config.webhookSecret);
  }
}

let override: StripeGateway | null = null;

export function setStripeGatewayForTests(gateway: StripeGateway | null): void {
  override = gateway;
}

/** Kastar BillingNotConfiguredError när miljön saknar kompletta Stripe-variabler. */
export function stripeGateway(env: Record<string, string | undefined> = process.env): StripeGateway {
  if (override) return override;
  const config = readStripeConfig(env);
  if (!config) throw new BillingNotConfiguredError();
  return new LiveStripeGateway(config);
}
