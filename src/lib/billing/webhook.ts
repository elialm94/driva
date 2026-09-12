/**
 * Stripe-webhooken: sanningskällan för abonnemangets tillstånd.
 *
 * Ordning per anrop:
 *   1. verifiera Stripe-Signature mot den råa kroppen (annars 400)
 *   2. logga händelsen på event-id – finns den redan är den klar (200)
 *   3. slå upp företaget (client_reference_id/metadata.businessId, annars
 *      Stripe-kund- eller abonnemangs-id) och skriv tillståndet
 *   4. markera raden bearbetad/ignorerad/fel
 *
 * Checkout-success aktiverar aldrig något själv: även checkout.session.completed
 * hämtar abonnemanget från Stripe och skriver det som det är. Händelser som
 * kommer i fel ordning (created äldre än det som redan skrivits) ignoreras.
 * Fakturahändelser läser om abonnemanget i stället för att gissa – en
 * misslyckad betalning blir past_due precis när Stripe säger det.
 */
import type Stripe from "stripe";
import { isStaleEvent, patchFromSubscription, type BusinessBilling, type SubscriptionSnapshot } from "./state";
import type { BillingStore } from "./store";
import type { StripeGateway } from "./stripe";
import { snapshotFromSubscription } from "./stripe";

export type WebhookOutcome =
  | { kind: "duplicate" }
  | { kind: "processed"; businessId: string; type: string }
  | { kind: "ignored"; type: string; reason: string }
  | { kind: "failed"; type: string; error: string };

export const HANDLED_EVENT_TYPES = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "customer.subscription.paused",
  "customer.subscription.resumed",
  "customer.subscription.trial_will_end",
  "invoice.paid",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "invoice.payment_action_required",
] as const;

export interface WebhookDeps {
  store: BillingStore;
  gateway: Pick<StripeGateway, "retrieveSubscription">;
}

function idOf(ref: string | { id: string } | null | undefined): string | undefined {
  if (!ref) return undefined;
  return typeof ref === "string" ? ref : ref.id;
}

/** Kort, sanerat fel för loggen – aldrig objektdumpar. */
function safeError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.replace(/sk_(live|test)_[A-Za-z0-9]+/g, "sk_***").slice(0, 300);
}

async function resolveBusiness(
  store: BillingStore,
  hints: { businessId?: string; customerId?: string; subscriptionId?: string }
): Promise<BusinessBilling | null> {
  if (hints.businessId) {
    const b = await store.billingForBusiness(hints.businessId);
    if (b) return b;
  }
  if (hints.subscriptionId) {
    const b = await store.businessByStripeSubscription(hints.subscriptionId);
    if (b) return b;
  }
  if (hints.customerId) {
    const b = await store.businessByStripeCustomer(hints.customerId);
    if (b) return b;
  }
  return null;
}

async function applySnapshot(
  deps: WebhookDeps,
  event: Stripe.Event,
  snapshot: SubscriptionSnapshot,
  opts: { deleted?: boolean; businessHint?: string } = {}
): Promise<WebhookOutcome> {
  const business = await resolveBusiness(deps.store, {
    businessId: opts.businessHint ?? snapshot.metadataBusinessId,
    customerId: snapshot.customerId,
    subscriptionId: snapshot.id,
  });
  if (!business) {
    return { kind: "ignored", type: event.type, reason: "Ingen matchning mot ett företag (kund-id, abonnemangs-id eller businessId saknas)." };
  }
  if (business.isDemo) {
    return { kind: "ignored", type: event.type, reason: "Demoföretag har inget abonnemang." };
  }
  if (isStaleEvent(business, event.created)) {
    return { kind: "ignored", type: event.type, reason: "Äldre än den händelse som redan skrivits (fel ordning)." };
  }
  // Ett annat abonnemang än det som redan är kopplat skrivs bara om det
  // gamla är avslutat – annars kunde ett gammalt uppsagt abonnemang som
  // ändras i Stripe skriva över det nya aktiva.
  if (
    business.stripeSubscriptionId &&
    business.stripeSubscriptionId !== snapshot.id &&
    business.subscriptionStatus !== "canceled" &&
    business.subscriptionStatus !== "expired" &&
    (snapshot.status === "canceled" || opts.deleted)
  ) {
    return { kind: "ignored", type: event.type, reason: "Gäller ett annat abonnemang än företagets aktuella." };
  }
  await deps.store.applySubscriptionPatch(business.businessId, patchFromSubscription(snapshot, event.created, opts.deleted));
  return { kind: "processed", businessId: business.businessId, type: event.type };
}

async function handle(deps: WebhookDeps, event: Stripe.Event): Promise<WebhookOutcome> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      if (session.mode !== "subscription") return { kind: "ignored", type: event.type, reason: "Inte en abonnemangs-checkout." };
      const businessId = session.client_reference_id ?? session.metadata?.businessId ?? undefined;
      const customerId = idOf(session.customer as string | { id: string } | null);
      const subscriptionId = idOf(session.subscription as string | { id: string } | null);
      if (businessId && customerId) {
        const business = await deps.store.billingForBusiness(businessId);
        if (business && !business.isDemo && business.stripeCustomerId !== customerId) {
          await deps.store.linkStripeCustomer(businessId, customerId);
        }
      }
      if (!subscriptionId) return { kind: "ignored", type: event.type, reason: "Sessionen har inget abonnemang ännu." };
      const snapshot = await deps.gateway.retrieveSubscription(subscriptionId);
      return applySnapshot(deps, event, snapshot, { businessHint: businessId });
    }

    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.paused":
    case "customer.subscription.resumed":
    case "customer.subscription.trial_will_end": {
      const sub = event.data.object as Stripe.Subscription;
      return applySnapshot(deps, event, snapshotFromSubscription(sub));
    }

    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return applySnapshot(deps, event, snapshotFromSubscription(sub), { deleted: true });
    }

    case "invoice.paid":
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
    case "invoice.payment_action_required": {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        idOf(invoice.parent?.subscription_details?.subscription as string | { id: string } | null | undefined) ??
        idOf((invoice as unknown as { subscription?: string | { id: string } | null }).subscription);
      if (!subscriptionId) return { kind: "ignored", type: event.type, reason: "Fakturan hör inte till ett abonnemang." };
      const snapshot = await deps.gateway.retrieveSubscription(subscriptionId);
      return applySnapshot(deps, event, snapshot, {
        businessHint: invoice.parent?.subscription_details?.metadata?.businessId ?? undefined,
      });
    }

    default:
      return { kind: "ignored", type: event.type, reason: "Händelsetypen hanteras inte." };
  }
}

/** Kör en redan verifierad händelse genom loggen och tillståndsskrivningen. */
export async function processStripeEvent(deps: WebhookDeps, event: Stripe.Event): Promise<WebhookOutcome> {
  const fresh = await deps.store.recordWebhookEvent({
    id: event.id,
    type: event.type,
    created: event.created,
    livemode: event.livemode,
    apiVersion: event.api_version ?? undefined,
  });
  if (!fresh) return { kind: "duplicate" };

  let outcome: WebhookOutcome;
  try {
    outcome = await handle(deps, event);
  } catch (e) {
    outcome = { kind: "failed", type: event.type, error: safeError(e) };
  }

  await deps.store.finishWebhookEvent(event.id, {
    status: outcome.kind === "processed" ? "bearbetad" : outcome.kind === "ignored" ? "ignorerad" : "fel",
    businessId: outcome.kind === "processed" ? outcome.businessId : undefined,
    error: outcome.kind === "failed" ? outcome.error : outcome.kind === "ignored" ? outcome.reason : undefined,
  });
  return outcome;
}
