import { db } from "../store";
import type { CompanySettings, Domain, Website } from "../types";
import { isDrivaAppHost } from "./config";
import { apexOf, isWww } from "./hostname";
import { findDomainByHostname } from "./store";

export interface PublicSiteResolution {
  domain: Domain;
  website: Website;
  company: CompanySettings;
  canonicalHostname: string;
  redirectToApex: boolean;
}

/**
 * Host → Domain → Website även om sajten är utkast eller pausad.
 * Används för att visa den neutrala "tillfälligt inte tillgänglig"-sidan
 * utan att läcka innehåll.
 */
export function lookupBoundPublicSite(hostHeader: string | null | undefined): PublicSiteResolution | null {
  if (!hostHeader) return null;
  const host = hostHeader.split(":")[0]?.toLowerCase() ?? "";
  if (!host || isDrivaAppHost(host)) return null;
  const domain = findDomainByHostname(host);
  if (!domain || domain.status !== "active") return null;
  const website = db().website;
  if (!website) return null;
  const apex = apexOf(domain.hostname);
  return {
    domain,
    website,
    company: db().settings,
    canonicalHostname: apex,
    redirectToApex: isWww(host) && domain.isPrimary,
  };
}

/**
 * Host → Domain → Website → Business. O(n) på få rader, unikt hostname-index i normalize.
 * Publicering av hemsidan rör aldrig DNS. Returnerar bara en live sajt.
 */
export function resolvePublicSite(hostHeader: string | null | undefined): PublicSiteResolution | null {
  const bound = lookupBoundPublicSite(hostHeader);
  if (!bound) return null;
  if (bound.website.status !== "publicerad") return null;
  return bound;
}

export function lookupHostname(hostname: string): Domain | undefined {
  return findDomainByHostname(hostname);
}
