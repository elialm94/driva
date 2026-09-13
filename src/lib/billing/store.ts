/**
 * Lagring för abonnemanget: företagsradens Stripe-fält och webhook-loggen.
 *
 * Körs UTANFÖR tenantkontexten (som membershipsForUser): webhooken har ingen
 * inloggad användare och läsningen i withBusiness sker innan rollen byts.
 * Alla skrivningar öppnar grinden app.allow_subscription_update i samma
 * transaktion – utan den nekar triggern (migration 24/51) varje ändring, även
 * från serverrollen. Klientstyrda PATCH:ar via Data API:t når aldrig hit.
 *
 * MemoryBillingStore används i tester och som tomt lager i JSON-läget.
 */
import { isSupabaseMode } from "../storage/config";
import { sqlClient } from "../storage/adapter-supabase";
import { ensurePendingSchema } from "../storage/apply-pending-schema";
import type { SqlRow } from "../storage/executor";
import type { BusinessBilling, CanonicalSubscriptionStatus, SubscriptionPatch } from "./state";

export interface WebhookEventInput {
  id: string;
  type: string;
  /** Stripe `created` (unix-sekunder). */
  created: number;
  livemode: boolean;
  apiVersion?: string;
}

export type WebhookEventStatus = "mottagen" | "bearbetad" | "ignorerad" | "fel";

export interface WebhookEventRow {
  id: string;
  receivedAt: string;
  eventCreated?: string;
  type: string;
  livemode: boolean;
  businessId?: string;
  status: WebhookEventStatus;
  error?: string;
  processedAt?: string;
}

export interface BillingStore {
  billingForBusiness(businessId: string): Promise<BusinessBilling | null>;
  businessByStripeCustomer(customerId: string): Promise<BusinessBilling | null>;
  businessByStripeSubscription(subscriptionId: string): Promise<BusinessBilling | null>;
  linkStripeCustomer(businessId: string, customerId: string): Promise<void>;
  applySubscriptionPatch(businessId: string, patch: SubscriptionPatch): Promise<BusinessBilling>;
  /** false = händelsen är redan mottagen (idempotens). */
  recordWebhookEvent(e: WebhookEventInput): Promise<boolean>;
  finishWebhookEvent(id: string, outcome: { status: WebhookEventStatus; businessId?: string; error?: string }): Promise<void>;
  listRecentWebhookEvents(limit?: number): Promise<WebhookEventRow[]>;
  countWebhookFailuresSince(sinceIso: string): Promise<number>;
  /** Händelser som tagits emot men inte avslutats (status "mottagen") – kö/hängande. */
  countWebhookQueued(): Promise<number>;
}

/* --------------------------------- Minne ----------------------------------- */

export class MemoryBillingStore implements BillingStore {
  readonly businesses = new Map<string, BusinessBilling>();
  readonly events = new Map<string, WebhookEventRow>();

  seed(b: BusinessBilling): void {
    this.businesses.set(b.businessId, { ...b });
  }

  async billingForBusiness(businessId: string): Promise<BusinessBilling | null> {
    const b = this.businesses.get(businessId);
    return b ? { ...b } : null;
  }

  async businessByStripeCustomer(customerId: string): Promise<BusinessBilling | null> {
    for (const b of this.businesses.values()) if (b.stripeCustomerId === customerId) return { ...b };
    return null;
  }

  async businessByStripeSubscription(subscriptionId: string): Promise<BusinessBilling | null> {
    for (const b of this.businesses.values()) if (b.stripeSubscriptionId === subscriptionId) return { ...b };
    return null;
  }

  async linkStripeCustomer(businessId: string, customerId: string): Promise<void> {
    const b = this.businesses.get(businessId);
    if (!b) throw new Error("Företaget finns inte.");
    b.stripeCustomerId = customerId;
    b.billingUpdatedAt = new Date().toISOString();
  }

  async applySubscriptionPatch(businessId: string, patch: SubscriptionPatch): Promise<BusinessBilling> {
    const b = this.businesses.get(businessId);
    if (!b) throw new Error("Företaget finns inte.");
    if (patch.stripeCustomerId) b.stripeCustomerId = patch.stripeCustomerId;
    b.stripeSubscriptionId = patch.stripeSubscriptionId;
    b.stripePriceId = patch.stripePriceId;
    b.stripeStatus = patch.stripeStatus;
    if (patch.subscriptionStatus) b.subscriptionStatus = patch.subscriptionStatus;
    b.currentPeriodEnd = patch.currentPeriodEnd;
    b.cancelAtPeriodEnd = patch.cancelAtPeriodEnd;
    b.billingEventCreated = patch.eventCreated;
    b.billingUpdatedAt = new Date().toISOString();
    return { ...b };
  }

  async recordWebhookEvent(e: WebhookEventInput): Promise<boolean> {
    if (this.events.has(e.id)) return false;
    this.events.set(e.id, {
      id: e.id,
      receivedAt: new Date().toISOString(),
      eventCreated: new Date(e.created * 1000).toISOString(),
      type: e.type,
      livemode: e.livemode,
      status: "mottagen",
    });
    return true;
  }

  async finishWebhookEvent(id: string, outcome: { status: WebhookEventStatus; businessId?: string; error?: string }): Promise<void> {
    const row = this.events.get(id);
    if (!row) return;
    row.status = outcome.status;
    row.businessId = outcome.businessId ?? row.businessId;
    row.error = outcome.error;
    row.processedAt = new Date().toISOString();
  }

  async listRecentWebhookEvents(limit = 50): Promise<WebhookEventRow[]> {
    return [...this.events.values()].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, limit);
  }

  async countWebhookFailuresSince(sinceIso: string): Promise<number> {
    return [...this.events.values()].filter((e) => e.status === "fel" && e.receivedAt >= sinceIso).length;
  }

  async countWebhookQueued(): Promise<number> {
    return [...this.events.values()].filter((e) => e.status === "mottagen").length;
  }
}

/* ----------------------------------- SQL ----------------------------------- */

const BILLING_COLUMNS = `id, is_demo, trial_started_at, trial_ends_at, subscription_status,
  stripe_customer_id, stripe_subscription_id, stripe_price_id, stripe_status,
  current_period_end, cancel_at_period_end, billing_updated_at, billing_event_created`;

function iso(v: unknown): string | undefined {
  if (v == null) return undefined;
  return v instanceof Date ? v.toISOString() : new Date(String(v)).toISOString();
}

function rowToBilling(r: SqlRow): BusinessBilling {
  return {
    businessId: String(r.id),
    isDemo: Boolean(r.is_demo),
    trialStartedAt: iso(r.trial_started_at),
    trialEndsAt: iso(r.trial_ends_at),
    subscriptionStatus: (r.subscription_status ? String(r.subscription_status) : null) as CanonicalSubscriptionStatus | null,
    stripeCustomerId: r.stripe_customer_id ? String(r.stripe_customer_id) : undefined,
    stripeSubscriptionId: r.stripe_subscription_id ? String(r.stripe_subscription_id) : undefined,
    stripePriceId: r.stripe_price_id ? String(r.stripe_price_id) : undefined,
    stripeStatus: r.stripe_status ? String(r.stripe_status) : undefined,
    currentPeriodEnd: iso(r.current_period_end),
    cancelAtPeriodEnd: Boolean(r.cancel_at_period_end),
    billingUpdatedAt: iso(r.billing_updated_at),
    billingEventCreated: r.billing_event_created == null ? undefined : Number(r.billing_event_created),
  };
}

function rowToEvent(r: SqlRow): WebhookEventRow {
  return {
    id: String(r.id),
    receivedAt: iso(r.received_at)!,
    eventCreated: iso(r.event_created),
    type: String(r.type),
    livemode: Boolean(r.livemode),
    businessId: r.business_id ? String(r.business_id) : undefined,
    status: String(r.status) as WebhookEventStatus,
    error: r.error ? String(r.error) : undefined,
    processedAt: iso(r.processed_at),
  };
}

export class SqlBillingStore implements BillingStore {
  private async client() {
    const client = await sqlClient();
    await ensurePendingSchema(client);
    return client;
  }

  async billingForBusiness(businessId: string): Promise<BusinessBilling | null> {
    const client = await this.client();
    const rows = await client.query(`select ${BILLING_COLUMNS} from public.businesses where id = $1::uuid limit 1`, [businessId]);
    return rows[0] ? rowToBilling(rows[0]) : null;
  }

  async businessByStripeCustomer(customerId: string): Promise<BusinessBilling | null> {
    const client = await this.client();
    const rows = await client.query(`select ${BILLING_COLUMNS} from public.businesses where stripe_customer_id = $1 limit 1`, [customerId]);
    return rows[0] ? rowToBilling(rows[0]) : null;
  }

  async businessByStripeSubscription(subscriptionId: string): Promise<BusinessBilling | null> {
    const client = await this.client();
    const rows = await client.query(`select ${BILLING_COLUMNS} from public.businesses where stripe_subscription_id = $1 limit 1`, [
      subscriptionId,
    ]);
    return rows[0] ? rowToBilling(rows[0]) : null;
  }

  async linkStripeCustomer(businessId: string, customerId: string): Promise<void> {
    const client = await this.client();
    await client.transaction(async (tx) => {
      await tx.query(`select set_config('app.allow_subscription_update', '1', true)`);
      await tx.query(
        `update public.businesses
            set stripe_customer_id = $2, billing_updated_at = now()
          where id = $1::uuid and (stripe_customer_id is null or stripe_customer_id = $2)`,
        [businessId, customerId]
      );
    });
  }

  async applySubscriptionPatch(businessId: string, patch: SubscriptionPatch): Promise<BusinessBilling> {
    const client = await this.client();
    const rows = await client.transaction(async (tx) => {
      await tx.query(`select set_config('app.allow_subscription_update', '1', true)`);
      return tx.query(
        `update public.businesses
            set stripe_customer_id     = coalesce($2, stripe_customer_id),
                stripe_subscription_id = $3,
                stripe_price_id        = $4,
                stripe_status          = $5,
                subscription_status    = coalesce($6, subscription_status),
                current_period_end     = $7::timestamptz,
                cancel_at_period_end   = $8,
                billing_event_created  = $9,
                billing_updated_at     = now()
          where id = $1::uuid
          returning ${BILLING_COLUMNS}`,
        [
          businessId,
          patch.stripeCustomerId ?? null,
          patch.stripeSubscriptionId,
          patch.stripePriceId ?? null,
          patch.stripeStatus,
          patch.subscriptionStatus ?? null,
          patch.currentPeriodEnd ?? null,
          patch.cancelAtPeriodEnd,
          patch.eventCreated,
        ]
      );
    });
    if (!rows[0]) throw new Error("Företaget finns inte.");
    return rowToBilling(rows[0]);
  }

  async recordWebhookEvent(e: WebhookEventInput): Promise<boolean> {
    const client = await this.client();
    const rows = await client.query(
      `insert into public.stripe_webhook_events (id, event_created, type, livemode, api_version)
       values ($1, to_timestamp($2), $3, $4, $5)
       on conflict (id) do nothing
       returning id`,
      [e.id, e.created, e.type, e.livemode, e.apiVersion ?? null]
    );
    return rows.length > 0;
  }

  async finishWebhookEvent(id: string, outcome: { status: WebhookEventStatus; businessId?: string; error?: string }): Promise<void> {
    const client = await this.client();
    await client.query(
      `update public.stripe_webhook_events
          set status = $2, business_id = coalesce($3::uuid, business_id), error = $4, processed_at = now()
        where id = $1`,
      [id, outcome.status, outcome.businessId ?? null, outcome.error ? outcome.error.slice(0, 500) : null]
    );
  }

  async listRecentWebhookEvents(limit = 50): Promise<WebhookEventRow[]> {
    const client = await this.client();
    const rows = await client.query(`select * from public.stripe_webhook_events order by received_at desc limit $1`, [limit]);
    return rows.map(rowToEvent);
  }

  async countWebhookFailuresSince(sinceIso: string): Promise<number> {
    const client = await this.client();
    const rows = await client.query(`select count(*)::int as n from public.stripe_webhook_events where status = 'fel' and received_at >= $1`, [
      sinceIso,
    ]);
    return Number(rows[0]?.n ?? 0);
  }

  async countWebhookQueued(): Promise<number> {
    const client = await this.client();
    const rows = await client.query(`select count(*)::int as n from public.stripe_webhook_events where status = 'mottagen'`);
    return Number(rows[0]?.n ?? 0);
  }
}

let override: BillingStore | null = null;
let memory: MemoryBillingStore | null = null;

/** Tester: byt lager. null återställer. */
export function setBillingStoreForTests(store: BillingStore | null): void {
  override = store;
}

export function billingStore(): BillingStore {
  if (override) return override;
  if (isSupabaseMode()) return new SqlBillingStore();
  // JSON-läget har inga riktiga företag och därmed inget abonnemang.
  if (!memory) memory = new MemoryBillingStore();
  return memory;
}
