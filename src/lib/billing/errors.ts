/**
 * Fel i abonnemangslagret. Meddelandena är skrivna för användaren och kan
 * visas rakt av; de innehåller aldrig nycklar, kund-id eller kortuppgifter.
 */

export class BillingNotConfiguredError extends Error {
  constructor(message = "Abonnemangsbetalning är inte konfigurerad för den här miljön.") {
    super(message);
    this.name = "BillingNotConfiguredError";
  }
}

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BillingError";
  }
}

/**
 * Företaget är skrivskyddat: provperioden är slut eller abonnemanget har
 * upphört. Allt går att läsa och exportera; nya ekonomiska ändringar stoppas
 * här, innan någon domänkod hunnit köra.
 */
export class SubscriptionReadOnlyError extends Error {
  readonly reason: string;
  constructor(reason: string, message: string) {
    super(message);
    this.name = "SubscriptionReadOnlyError";
    this.reason = reason;
  }
}

export function userFacingBillingError(e: unknown): string {
  if (e instanceof BillingNotConfiguredError || e instanceof BillingError || e instanceof SubscriptionReadOnlyError) {
    return e.message;
  }
  return "Något gick fel med abonnemanget. Försök igen om en stund.";
}
