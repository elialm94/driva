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
  try {
    const result = await searchDomain(query);
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte söka just nu." };
  }
}

export async function purchaseDomainAction(
  hostname: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string; missingProfile?: boolean }> {
  const missing = missingRegistrantFields();
  if (missing.length) {
    return { ok: false, error: "En uppgift saknas innan domänen kan registreras", missingProfile: true };
  }
  try {
    const domain = await purchaseDomain(hostname);
    refresh();
    return { ok: true, view: await viewOf(domain) };
  } catch (e) {
    return {
      ok: false,
      error: isDomainError(e) ? e.message : "Kunde inte köpa adressen.",
      missingProfile: isDomainError(e) && e.category === "profile_incomplete",
    };
  }
}

export async function pollDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  try {
    const domain = await advanceProvisioning(domainId);
    if (domain.status === "active" || domain.provisioning.lastError) refresh();
    return { ok: true, view: await viewOf(domain) };
  } catch (e) {
    return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte uppdatera status." };
  }
}

export async function retryDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  try {
    const domain = await retryProvisioning(domainId);
    refresh();
    return { ok: true, view: await viewOf(domain) };
  } catch (e) {
    return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte försöka igen." };
  }
}

export async function setAutoRenewAction(
  domainId: string,
  enabled: boolean,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  try {
    const domain = await setAutoRenew(domainId, enabled);
    refresh();
    return { ok: true, view: await viewOf(domain) };
  } catch (e) {
    return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte uppdatera förnyelsen." };
  }
}

export async function startExistingDomainAction(
  hostname: string,
): Promise<
  | { ok: true; view: DomainCardView; dnsChanges: DnsRecordInstruction[] }
  | { ok: false; error: string }
> {
  try {
    const { domain, dnsChanges } = await startExistingDomain(hostname);
    refresh();
    const view = await viewOf(domain);
    view.dnsChanges = dnsChanges;
    return { ok: true, view, dnsChanges };
  } catch (e) {
    return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte lägga till adressen." };
  }
}

export async function verifyExistingDomainAction(
  domainId: string,
): Promise<{ ok: true; view: DomainCardView } | { ok: false; error: string }> {
  try {
    const domain = await verifyExistingDomain(domainId);
    refresh();
    return { ok: true, view: await viewOf(domain) };
  } catch (e) {
    try {
      const current = requireOwnedDomain(domainId);
      return { ok: true, view: await viewOf(current) };
    } catch {
      return { ok: false, error: isDomainError(e) ? e.message : "Kunde inte kontrollera anslutningen." };
    }
  }
}
