/**
 * Abonnemangets tillstånd – rena funktioner utan Stripe-klient eller lager.
 *
 * Kanoniskt tillstånd (businesses.subscription_status):
 *
 *   trialing   14 dagars provperiod utan kort (satt vid signup), eller ett
 *              Stripe-abonnemang i trial
 *   active     betalt abonnemang
 *   past_due   betalning misslyckades tillfälligt – grace, skrivåtkomsten
 *              behålls tills Stripes retry-/dunningpolicy är uttömd
 *   expired    provperiod slut utan abonnemang, eller abonnemang som Stripe
 *              gett upp (unpaid/paused)
 *   canceled   uppsagt; skrivåtkomst till periodens slut
 *   null       företag från före provperiodsmodellen – aldrig utelåsta
 *
 * Webhooken är sanningskällan för allt som kommer från Stripe. Provperioden
 * utan kort avgörs här ur trial_ends_at. Skrivskydd = allt går att läsa och
 * exportera; nya ekonomiska ändringar stoppas.
 */

export type CanonicalSubscriptionStatus = "trialing" | "active" | "past_due" | "expired" | "canceled";

export const PLAN = {
  name: "Ferva",
  /** Visningspris. Det verkliga priset ligger på STRIPE_PRICE_ID i Stripe. */
  pricePerMonthExVat: 199,
  currency: "SEK",
  trialDays: 14,
} as const;

export interface BusinessBilling {
  businessId: string;
  isDemo: boolean;
  trialStartedAt?: string;
  trialEndsAt?: string;
  subscriptionStatus: CanonicalSubscriptionStatus | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  stripePriceId?: string;
  /** Stripes råa status som den senast rapporterades. */
  stripeStatus?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  billingUpdatedAt?: string;
  /** Stripe-eventets `created` (unix-sekunder) som skrev senast. */
  billingEventCreated?: number;
}

/**
 * Stripes status → kanoniskt tillstånd. null = "ändra inte tillståndet"
 * (incomplete-lägena: Checkout påbörjad men inte betald – provperioden gäller
 * tills något verkligt händer).
 */
export function mapStripeStatus(status: string): CanonicalSubscriptionStatus | null {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "canceled":
      return "canceled";
    case "unpaid":
    case "paused":
      return "expired";
    case "incomplete":
    case "incomplete_expired":
      return null;
    default:
      return null;
  }
}

export type AccessMode = "full" | "read_only";

export type AccessReason =
  | "demo"
  | "legacy"
  | "trial"
  | "active"
  | "cancel_scheduled"
  | "grace"
  | "trial_expired"
  | "subscription_ended"
  | "canceled";

export interface BillingAccess {
  mode: AccessMode;
  reason: AccessReason;
  status: CanonicalSubscriptionStatus | null;
  /** Dagar kvar av provperioden (bara under trial utan kort). */
  trialDaysLeft?: number;
  trialEndsAt?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  hasStripeSubscription: boolean;
  hasStripeCustomer: boolean;
  /** Mening att visa användaren, i den ton Inställningar har. */
  message: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function daysLeft(untilIso: string, now: Date): number {
  return Math.max(0, Math.ceil((Date.parse(untilIso) - now.getTime()) / DAY_MS));
}

function sv(iso: string): string {
  return new Intl.DateTimeFormat("sv-SE", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Stockholm" }).format(
    new Date(iso)
  );
}

/** Vad får företaget göra just nu? Rent beslut ur raden + klockan. */
export function billingAccess(b: BusinessBilling, now: Date = new Date()): BillingAccess {
  const base = {
    status: b.subscriptionStatus,
    trialEndsAt: b.trialEndsAt,
    currentPeriodEnd: b.currentPeriodEnd,
    cancelAtPeriodEnd: b.cancelAtPeriodEnd,
    hasStripeSubscription: Boolean(b.stripeSubscriptionId),
    hasStripeCustomer: Boolean(b.stripeCustomerId),
  };

  if (b.isDemo) {
    return { ...base, mode: "full", reason: "demo", message: "Demoföretag – inget abonnemang behövs." };
  }
  if (b.subscriptionStatus == null) {
    return { ...base, mode: "full", reason: "legacy", message: "Företaget har ingen provperiod registrerad." };
  }

  switch (b.subscriptionStatus) {
    case "active": {
      if (b.cancelAtPeriodEnd && b.currentPeriodEnd) {
        return {
          ...base,
          mode: "full",
          reason: "cancel_scheduled",
          message: `Abonnemanget är uppsagt och gäller till ${sv(b.currentPeriodEnd)}. Därefter blir företaget skrivskyddat – allt går fortfarande att läsa och exportera.`,
        };
      }
      return {
        ...base,
        mode: "full",
        reason: "active",
        message: b.currentPeriodEnd ? `Abonnemanget är aktivt. Nästa period börjar ${sv(b.currentPeriodEnd)}.` : "Abonnemanget är aktivt.",
      };
    }
    case "past_due":
      return {
        ...base,
        mode: "full",
        reason: "grace",
        message:
          "Den senaste betalningen gick inte igenom. Stripe försöker igen automatiskt; uppdatera kortet i kundportalen så att inget avbryts. Tills dess fungerar allt som vanligt.",
      };
    case "trialing": {
      if (b.stripeSubscriptionId && b.stripeStatus === "trialing") {
        return {
          ...base,
          mode: "full",
          reason: "trial",
          trialDaysLeft: b.currentPeriodEnd ? daysLeft(b.currentPeriodEnd, now) : undefined,
          message: b.currentPeriodEnd ? `Provperiod via Stripe till ${sv(b.currentPeriodEnd)}.` : "Provperiod via Stripe.",
        };
      }
      if (!b.trialEndsAt) {
        return { ...base, mode: "full", reason: "legacy", message: "Företaget har ingen provperiod registrerad." };
      }
      const left = daysLeft(b.trialEndsAt, now);
      if (Date.parse(b.trialEndsAt) > now.getTime()) {
        return {
          ...base,
          mode: "full",
          reason: "trial",
          trialDaysLeft: left,
          message:
            left === 1
              ? "Sista dagen av provperioden i dag."
              : `${left} dagar kvar av provperioden (till ${sv(b.trialEndsAt)}).`,
        };
      }
      return {
        ...base,
        mode: "read_only",
        reason: "trial_expired",
        trialDaysLeft: 0,
        message: `Provperioden tog slut ${sv(b.trialEndsAt)}. Allt går att läsa och exportera; för att bokföra, fakturera och ändra behöver företaget ett abonnemang.`,
      };
    }
    case "canceled": {
      if (b.currentPeriodEnd && Date.parse(b.currentPeriodEnd) > now.getTime()) {
        return {
          ...base,
          mode: "full",
          reason: "cancel_scheduled",
          message: `Abonnemanget är uppsagt och gäller till ${sv(b.currentPeriodEnd)}.`,
        };
      }
      return {
        ...base,
        mode: "read_only",
        reason: "canceled",
        message: "Abonnemanget är avslutat. Allt går att läsa och exportera; teckna ett nytt abonnemang för att fortsätta arbeta.",
      };
    }
    case "expired":
    default:
      return {
        ...base,
        mode: "read_only",
        reason: "subscription_ended",
        message: "Abonnemanget har upphört. Allt går att läsa och exportera; teckna ett nytt abonnemang för att fortsätta arbeta.",
      };
  }
}

/** Kort etikett för listor och admin. */
export const SUBSCRIPTION_STATUS_LABEL: Record<CanonicalSubscriptionStatus, string> = {
  trialing: "Provperiod",
  active: "Aktivt",
  past_due: "Betalning väntar",
  expired: "Utgånget",
  canceled: "Uppsagt",
};

export interface SubscriptionSnapshot {
  id: string;
  customerId?: string;
  status: string;
  priceId?: string;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  metadataBusinessId?: string;
}

export interface SubscriptionPatch {
  stripeCustomerId?: string;
  stripeSubscriptionId: string;
  stripePriceId?: string;
  stripeStatus: string;
  /** null = ändra inte det kanoniska tillståndet. */
  subscriptionStatus: CanonicalSubscriptionStatus | null;
  currentPeriodEnd?: string;
  cancelAtPeriodEnd: boolean;
  eventCreated: number;
}

/** Ett Stripe-abonnemang → det vi skriver på företagsraden. */
export function patchFromSubscription(s: SubscriptionSnapshot, eventCreated: number, deleted = false): SubscriptionPatch {
  const status = deleted ? "canceled" : s.status;
  return {
    stripeCustomerId: s.customerId,
    stripeSubscriptionId: s.id,
    stripePriceId: s.priceId,
    stripeStatus: status,
    subscriptionStatus: mapStripeStatus(status),
    currentPeriodEnd: s.currentPeriodEnd,
    cancelAtPeriodEnd: deleted ? false : s.cancelAtPeriodEnd,
    eventCreated,
  };
}

/**
 * Får en händelse skriva? Stripe garanterar inte ordningen; en äldre händelse
 * som kommer efter en nyare får inte rulla tillbaka tillståndet.
 */
export function isStaleEvent(current: BusinessBilling, eventCreated: number): boolean {
  return current.billingEventCreated != null && eventCreated < current.billingEventCreated;
}
