import { db, save } from "../store";
import { uid } from "../ids";
import type { Domain } from "../types";
import { logActivity } from "../services/activity";
import { logDomainAudit } from "./audit";
import { effectiveDomainRuntimeMode } from "./mode";
import { DomainError } from "./errors";
import { getHostingProvider, type DnsRecordInstruction } from "./hosting";
import { parseHostnameInput } from "./hostname";
import { advanceProvisioning } from "./provisioning";
import { assertHostnameAvailableToBusiness, currentBusinessId, findDomainByHostname } from "./store";

export interface ExistingDomainSetup {
  domain: Domain;
  /** Endast den här vägen får visa CNAME. */
  dnsChanges: DnsRecordInstruction[];
}

export async function startExistingDomain(raw: string): Promise<ExistingDomainSetup> {
  const parsed = parseHostnameInput(raw);
  const businessId = currentBusinessId();
  const already = findDomainByHostname(parsed.hostname);
  if (already) {
    if (already.businessId !== businessId) throw new DomainError("conflict", "Den adressen är redan kopplad.");
    const dns = already.source === "existing" ? await getHostingProvider().requiredDns(already.hostname) : [];
    return { domain: already, dnsChanges: dns.filter((r) => r.type === "CNAME" || r.purpose === "verify") };
  }
  assertHostnameAvailableToBusiness(parsed.hostname, businessId);

  const now = new Date().toISOString();
  const hasPrimary = db().domains.some((d) => d.businessId === businessId && d.isPrimary);
  const domain: Domain = {
    id: uid(),
    businessId,
    websiteId: db().website?.id,
    hostname: parsed.hostname,
    tld: parsed.tld,
    source: "existing",
    registrarProvider: effectiveDomainRuntimeMode() === "mock" ? "mock" : "openprovider",
    status: "configuring",
    isPrimary: !hasPrimary,
    autoRenew: false,
    verificationStatus: "pending",
    sslStatus: "pending",
    billing: {
      customerPrice: 0,
      purchasePrice: 0,
      currency: "SEK",
      autoRenew: false,
      status: "paid",
      idempotencyKey: `existing:${businessId}:${parsed.hostname}`,
    },
    provisioning: {
      step: "hosting",
      billed: true,
      registered: false,
      registrantCreated: false,
      nameserversConfigured: false,
      hostingAttached: false,
      dnsVerified: false,
      sslReady: false,
      ticks: 0,
    },
    idempotencyKey: `existing:${businessId}:${parsed.hostname}`,
    createdAt: now,
    updatedAt: now,
  };
  db().domains.push(domain);
  save();
  logDomainAudit("domain_existing_started", `Anslutning av ${domain.hostname} påbörjad.`, {
    domainId: domain.id,
    hostname: domain.hostname,
  });
  logActivity(`Anslutning av befintlig adress ${domain.hostname} påbörjades.`, {
    entity: { type: "doman", id: domain.id },
  });

  const hosting = getHostingProvider();
  await hosting.addCustomDomain(domain.hostname, `hosting:${domain.idempotencyKey}`);
  domain.provisioning.hostingAttached = true;
  save();
  const records = await hosting.requiredDns(domain.hostname);
  const dnsChanges = records.filter((r) => r.type === "CNAME" || r.purpose === "verify");
  return { domain, dnsChanges: dnsChanges.length ? dnsChanges : records.filter((r) => r.type === "CNAME") };
}

export async function verifyExistingDomain(domainId: string): Promise<Domain> {
  let result = await advanceProvisioning(domainId);
  if (result.status !== "active" && !result.provisioning.lastError) {
    result = await advanceProvisioning(domainId);
  }
  if (result.status !== "active") {
    throw new DomainError("dns_pending", "Ändringen syns inte ännu. Det kan ta en stund – prova igen.");
  }
  return result;
}
