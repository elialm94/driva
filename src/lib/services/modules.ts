import { db, save } from "../store";
import type { CompanySettings, DB } from "../types";

/**
 * Optional business-moduler. V1: bara Hemsida. Samarbeta lämnas orört.
 * Svarar på "ska Hemsida visas i menyn?" utan extra website-query –
 * anroparen använder redan laddad tenant-data (`db()` / settings).
 */

export type WebsiteUsageSource = Pick<DB, "website" | "domains">;

export function hasWebsiteUsage(data: WebsiteUsageSource): boolean {
  return data.website != null || data.domains.length > 0;
}

export function isWebsiteNavVisible(
  settings: Pick<CompanySettings, "websiteNavVisible">,
  usage: WebsiteUsageSource
): boolean {
  if (settings.websiteNavVisible === true) return true;
  if (settings.websiteNavVisible === false) return false;
  return hasWebsiteUsage(usage);
}

export function websiteModuleState(data: Pick<DB, "settings" | "website" | "domains">): {
  navVisible: boolean;
  published: boolean;
  hasWebsite: boolean;
} {
  return {
    navVisible: isWebsiteNavVisible(data.settings, data),
    published: data.website?.status === "publicerad",
    hasWebsite: data.website != null,
  };
}

/** Sätt synlighet utan att spara – anroparen äger persist (t.ex. generateWebsite). */
export function markWebsiteModuleUsed(data: Pick<DB, "settings"> = db()): void {
  data.settings.websiteNavVisible = true;
}

/** Aktivera Hemsida för företaget. Rör inte innehåll, publicering eller domän. */
export function activateWebsiteModule(): void {
  markWebsiteModuleUsed();
  save();
}

/**
 * Dölj Hemsida i menyn. Raderar inte sajt, avpublicerar inte, rör inte
 * domän eller innehåll. Den publika sajten fortsätter vara live.
 */
export function hideWebsiteFromNav(): void {
  db().settings.websiteNavVisible = false;
  save();
}
