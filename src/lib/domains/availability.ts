import { logDomainAudit } from "./audit";
import { getDomainRegistrar } from "./registrar";
import { mockTakenHostnames } from "./registrar/mock";
import { parseHostnameInput, suggestAlternatives } from "./hostname";
import { findDomainByHostname } from "./store";
import { DomainError } from "./errors";
import type { DomainTld } from "../types";

export interface SearchResult {
  hostname: string;
  tld: DomainTld;
  available: boolean;
  price?: { customerPrice: number; currency: "SEK"; periodYears: number };
  alternatives: string[];
}

export async function searchDomain(raw: string, actor: "anvandare" | "assistent" = "anvandare"): Promise<SearchResult> {
  const parsed = parseHostnameInput(raw);
  const existing = findDomainByHostname(parsed.hostname);
  if (existing) {
    logDomainAudit("domain_searched", `${parsed.hostname} är redan kopplad i Driva.`, {
      actor,
      hostname: parsed.hostname,
      domainId: existing.id,
    });
    return {
      hostname: parsed.hostname,
      tld: parsed.tld,
      available: false,
      alternatives: suggestAlternatives(parsed.label, parsed.tld, new Set([parsed.hostname, ...mockTakenHostnames()])),
    };
  }

  const registrar = getDomainRegistrar();
  const result = await registrar.checkAvailability(parsed.hostname, parsed.tld);
  logDomainAudit("domain_searched", result.available ? `${parsed.hostname} är ledig.` : `${parsed.hostname} är upptagen.`, {
    actor,
    hostname: parsed.hostname,
  });

  const taken = mockTakenHostnames();
  if (!result.available) taken.add(parsed.hostname);

  return {
    hostname: parsed.hostname,
    tld: parsed.tld,
    available: result.available,
    price: result.available && result.price
      ? { customerPrice: result.price.customerPrice, currency: result.price.currency, periodYears: result.price.periodYears }
      : undefined,
    alternatives: result.available ? [] : suggestAlternatives(parsed.label, parsed.tld, taken),
  };
}

export function searchErrorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  return "Kunde inte söka just nu. Försök igen.";
}
