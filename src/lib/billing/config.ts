/**
 * Stripe-konfiguration – ren läsning av miljön, server-only.
 *
 *   STRIPE_SECRET_KEY        sk_test_… | sk_live_…      (krävs)
 *   STRIPE_WEBHOOK_SECRET    whsec_…                    (krävs)
 *   STRIPE_PRICE_ID          price_…                    (krävs; Ferva 199 kr/mån ex moms)
 *   STRIPE_PUBLISHABLE_KEY   pk_test_… | pk_live_…      (valfri; måste matcha läge)
 *
 * Saknas något är Stripe "inte konfigurerat" och UI:t säger det – inget
 * abonnemang simuleras för riktiga företag. Problem listas i klartext för
 * admin-systemvyn utan att läcka värden.
 */

export type StripeMode = "test" | "live";

export interface StripeConfig {
  secretKey: string;
  webhookSecret: string;
  priceId: string;
  publishableKey?: string;
  mode: StripeMode;
}

type EnvSource = Record<string, string | undefined>;

function trimmed(env: EnvSource, key: string): string | undefined {
  const v = env[key]?.trim();
  return v ? v : undefined;
}

function keyMode(key: string): StripeMode | null {
  if (/^(sk|rk)_test_/.test(key)) return "test";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  return null;
}

function publishableMode(key: string): StripeMode | null {
  if (key.startsWith("pk_test_")) return "test";
  if (key.startsWith("pk_live_")) return "live";
  return null;
}

/**
 * Alla problem med konfigurationen, i klartext. Tom lista = komplett och
 * konsekvent. Används av readStripeConfig (null vid minsta problem) och av
 * admin-systemvyn (visar listan).
 */
export function stripeConfigProblems(env: EnvSource = process.env): string[] {
  const problems: string[] = [];
  const secret = trimmed(env, "STRIPE_SECRET_KEY");
  const webhook = trimmed(env, "STRIPE_WEBHOOK_SECRET");
  const price = trimmed(env, "STRIPE_PRICE_ID");
  const publishable = trimmed(env, "STRIPE_PUBLISHABLE_KEY");

  if (!secret) problems.push("STRIPE_SECRET_KEY saknas.");
  else if (!keyMode(secret)) problems.push("STRIPE_SECRET_KEY ser inte ut som en Stripe-nyckel (sk_test_… eller sk_live_…).");

  if (!webhook) problems.push("STRIPE_WEBHOOK_SECRET saknas.");
  else if (!webhook.startsWith("whsec_")) problems.push("STRIPE_WEBHOOK_SECRET ska börja med whsec_.");

  if (!price) problems.push("STRIPE_PRICE_ID saknas.");
  else if (!price.startsWith("price_")) problems.push("STRIPE_PRICE_ID ska vara ett pris-id (price_…), inte ett produkt-id.");

  if (publishable) {
    const pm = publishableMode(publishable);
    if (!pm) problems.push("STRIPE_PUBLISHABLE_KEY ser inte ut som en publicerbar nyckel (pk_test_… eller pk_live_…).");
    else if (secret && keyMode(secret) && pm !== keyMode(secret)) {
      problems.push(`STRIPE_PUBLISHABLE_KEY är i ${pm}-läge men STRIPE_SECRET_KEY i ${keyMode(secret)}-läge.`);
    }
  }

  if (secret && keyMode(secret) === "live" && env.NODE_ENV !== "production" && env.VERCEL_ENV !== "production") {
    problems.push("Live-nyckel utanför produktion: använd sk_test_… i utveckling och förhandsmiljöer.");
  }
  return problems;
}

export function readStripeConfig(env: EnvSource = process.env): StripeConfig | null {
  if (stripeConfigProblems(env).length > 0) return null;
  const secretKey = trimmed(env, "STRIPE_SECRET_KEY")!;
  return {
    secretKey,
    webhookSecret: trimmed(env, "STRIPE_WEBHOOK_SECRET")!,
    priceId: trimmed(env, "STRIPE_PRICE_ID")!,
    publishableKey: trimmed(env, "STRIPE_PUBLISHABLE_KEY"),
    mode: keyMode(secretKey)!,
  };
}

export function isStripeConfigured(env: EnvSource = process.env): boolean {
  return readStripeConfig(env) !== null;
}

/** Läget utan att kräva komplett konfiguration – för systemvyn. */
export function stripeModeHint(env: EnvSource = process.env): StripeMode | null {
  const secret = trimmed(env, "STRIPE_SECRET_KEY");
  return secret ? keyMode(secret) : null;
}
