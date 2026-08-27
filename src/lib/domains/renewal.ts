import { save } from "../store";
import { logDomainAudit } from "./audit";
import { getBillingProvider } from "./billing";
import { DomainError } from "./errors";
import { getDomainRegistrar } from "./registrar";
import { requireOwnedDomain } from "./store";
import type { Domain } from "../types";

export async function setAutoRenew(domainId: string, enabled: boolean): Promise<Domain> {
  const domain = requireOwnedDomain(domainId);
  if (domain.source !== "purchased") {
    throw new DomainError("validation", "Automatisk förnyelse gäller bara adresser du köpt i Driva.");
  }
  domain.autoRenew = enabled;
  domain.billing.autoRenew = enabled;
  if (!enabled) {
    await getDomainRegistrar().cancelAutoRenew(domain.hostname);
  }
  domain.updatedAt = new Date().toISOString();
  save();
  logDomainAudit("domain_autorenew_changed", enabled ? "Automatisk förnyelse är på." : "Automatisk förnyelse är av.", {
    domainId: domain.id,
    hostname: domain.hostname,
    actor: "anvandare",
  });
  return domain;
}

export async function processRenewal(domainId: string): Promise<Domain> {
  const domain = requireOwnedDomain(domainId);
  if (!domain.autoRenew) return domain;
  const billed = await getBillingProvider().charge({
    idempotencyKey: `renew:${domain.id}:${domain.expiresAt ?? domain.id}`,
    amount: domain.billing.customerPrice,
    currency: "SEK",
    description: `Förnyelse ${domain.hostname}`,
    hostname: domain.hostname.startsWith("fail-fornya") ? "fail-betala.se" : domain.hostname,
  });
  if (!billed.ok) {
    domain.billing.status = "renewal_failed";
    domain.updatedAt = new Date().toISOString();
    save();
    logDomainAudit("domain_renewal_failed", "Förnyelsen kunde inte betalas.", {
      domainId: domain.id,
      hostname: domain.hostname,
    });
    throw new DomainError("payment_failed", "Förnyelsen kunde inte betalas.");
  }
  const rec = await getDomainRegistrar().renewDomain(domain.hostname, 1);
  domain.expiresAt = rec.expiresAt;
  domain.billing.renewsAt = rec.expiresAt;
  domain.billing.status = "paid";
  domain.updatedAt = new Date().toISOString();
  save();
  return domain;
}

/** Test/demo: markera förnyelse som misslyckad utan att anropa registret. */
export function markRenewalFailed(domainId: string): Domain {
  const domain = requireOwnedDomain(domainId);
  domain.billing.status = "renewal_failed";
  domain.updatedAt = new Date().toISOString();
  save();
  logDomainAudit("domain_renewal_failed", "Förnyelsen kunde inte betalas.", {
    domainId: domain.id,
    hostname: domain.hostname,
  });
  return domain;
}
