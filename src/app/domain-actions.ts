"use server";

import { revalidatePath } from "next/cache";
import {
  searchDomain,
  purchaseDomain,
  advanceProvisioning,
  retryProvisioning,
  startExistingDomain,
  verifyExistingDomain,
  setAutoRenew,
  enrichDomainView,
  isDomainError,
  requireOwnedDomain,
  missingRegistrantFields,
} from "@/lib/domains";
import { getBusinessProfile } from "@/lib/services/settings";
import type { DnsRecordInstruction } from "@/lib/domains/hosting";
import type { DomainCardView } from "@/lib/domains/view";
import type { SearchResult } from "@/lib/domains/availability";
import { withBusiness } from "@/lib/auth/session";

/**
 * Domänflödena pratar med extern registrar (mock/live) – retry vid
 * samtidighetskonflikt är avstängt så att ett köp aldrig görs om.
 */
const NO_RETRY = { retry: false } as const;

function refresh() {
  revalidatePath("/hemsida", "layout");
  revalidatePath("/hemsida/doman");
  revalidatePath("/installningar");
}

async function viewOf(domain: Parameters<typeof enrichDomainView>[0]) {
  return enrichDomainView(domain, getBusinessProfile());
}

export async function searchDomainAction(
  query: string,
): Promise<{ ok: true; result: SearchResult } | { ok: false; error: string }> {
  return withBusiness(async () => {
    try {
      const result = await searchDomain(query);
      return { ok: true, result } as const;
    } catch (e) {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte söka just nu." } as const;
    }
  }, NO_RETRY);
}

export async function purchaseDomainAction(
  hostname: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string; missingProfile?: boolean }> {
  return withBusiness(async () => {
    const missing = missingRegistrantFields();
    if (missing.length) {
      return { ok: false, error: "En uppgift saknas innan domänen kan registreras", missingProfile: true } as const;
    }
    try {
      const domain = await purchaseDomain(hostname);
      refresh();
      return { ok: true, view: await viewOf(domain) } as const;
    } catch (e) {
      return {
        ok: false,
        error: isDomainError(e) ? e.message : "Kunde inte köpa adressen.",
        missingProfile: isDomainError(e) && e.category === "profile_incomplete",
      } as const;
    }
  }, NO_RETRY);
}

export async function pollDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  return withBusiness(async () => {
    try {
      const domain = await advanceProvisioning(domainId);
      if (domain.status === "active" || domain.provisioning.lastError) refresh();
      return { ok: true, view: await viewOf(domain) } as const;
    } catch (e) {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte uppdatera status." } as const;
    }
  }, NO_RETRY);
}

export async function retryDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  return withBusiness(async () => {
    try {
      const domain = await retryProvisioning(domainId);
      refresh();
      return { ok: true, view: await viewOf(domain) } as const;
    } catch (e) {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte försöka igen." } as const;
    }
  }, NO_RETRY);
}

export async function setAutoRenewAction(
  domainId: string,
  enabled: boolean,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  return withBusiness(async () => {
    try {
      const domain = await setAutoRenew(domainId, enabled);
      refresh();
      return { ok: true, view: await viewOf(domain) } as const;
    } catch (e) {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte uppdatera förnyelsen." } as const;
    }
  }, NO_RETRY);
}

export async function startExistingDomainAction(
  hostname: string,
): Promise<
  | { ok: true; view: DomainCardView; dnsChanges: DnsRecordInstruction[] }
  | { ok: false; error: string }
> {
  return withBusiness(async () => {
    try {
      const { domain, dnsChanges } = await startExistingDomain(hostname);
      refresh();
      const view = await viewOf(domain);
      view.dnsChanges = dnsChanges;
      return { ok: true, view, dnsChanges } as const;
    } catch (e) {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte lägga till adressen." } as const;
    }
  }, NO_RETRY);
}

export async function verifyExistingDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  return withBusiness(async () => {
    try {
      const domain = await verifyExistingDomain(domainId);
      refresh();
      return { ok: true, view: await viewOf(domain) } as const;
    } catch (e) {
      try {
        const current = requireOwnedDomain(domainId);
        return { ok: true, view: await viewOf(current) } as const;
      } catch {
        return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte kontrollera anslutningen." } as const;
      }
    }
  }, NO_RETRY);
}
