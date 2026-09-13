/**
 * Skrivgrinden för abonnemanget: läses av withBusiness före varje skrivande
 * flöde och av sidskalet för bannern. En liten TTL-cache per instans håller
 * kostnaden på en PK-fråga per företag och halvminut; webhooken tömmer den
 * när den skriver.
 */
import { isSupabaseMode } from "../storage/config";
import { SubscriptionReadOnlyError } from "./errors";
import { billingAccess, type BillingAccess, type BusinessBilling } from "./state";
import { billingStore } from "./store";

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; billing: BusinessBilling | null }>();

export function invalidateBillingCache(businessId?: string): void {
  if (businessId) cache.delete(businessId);
  else cache.clear();
}

export async function billingForBusinessCached(businessId: string): Promise<BusinessBilling | null> {
  const hit = cache.get(businessId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.billing;
  const billing = await billingStore().billingForBusiness(businessId);
  cache.set(businessId, { at: Date.now(), billing });
  return billing;
}

const NO_BILLING: BillingAccess = {
  mode: "full",
  reason: "demo",
  status: null,
  cancelAtPeriodEnd: false,
  hasStripeSubscription: false,
  hasStripeCustomer: false,
  message: "Demoföretag – inget abonnemang behövs.",
};

/**
 * Vad får företaget göra just nu? JSON-läget och demosessioner har inget
 * abonnemang. Ett företag som inte hittas (t.ex. under en migrering) låses
 * inte ute – ärlig fallback är öppen, aldrig en låst dörr av misstag.
 */
export async function currentBillingAccess(businessId: string, opts: { demo?: boolean } = {}): Promise<BillingAccess> {
  if (opts.demo || !isSupabaseMode()) return NO_BILLING;
  try {
    const billing = await billingForBusinessCached(businessId);
    if (!billing) return { ...NO_BILLING, reason: "legacy", message: "Företaget har ingen provperiod registrerad." };
    return billingAccess(billing);
  } catch {
    return { ...NO_BILLING, reason: "legacy", message: "Abonnemangets status kunde inte läsas." };
  }
}

/** Kastar SubscriptionReadOnlyError om företaget är skrivskyddat. */
export async function assertWritable(businessId: string, opts: { demo?: boolean } = {}): Promise<void> {
  const access = await currentBillingAccess(businessId, opts);
  if (access.mode === "read_only") {
    throw new SubscriptionReadOnlyError(access.reason, `${access.message} Gå till Inställningar → Konto för att fortsätta.`);
  }
}
