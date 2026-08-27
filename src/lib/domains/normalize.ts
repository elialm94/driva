import type { Domain } from "../types";
import { CURRENT_BUSINESS_ID } from "./config";

function emptyProvisioning(): Domain["provisioning"] {
  return {
    step: "profile",
    billed: false,
    registered: false,
    registrantCreated: false,
    nameserversConfigured: false,
    hostingAttached: false,
    dnsVerified: false,
    sslReady: false,
    ticks: 0,
  };
}

function emptyBilling(): Domain["billing"] {
  return {
    customerPrice: 0,
    purchasePrice: 0,
    currency: "SEK",
    autoRenew: true,
    status: "pending",
    idempotencyKey: "",
  };
}

export function normalizeDomains(loaded: { domains?: Domain[]; domainAudit?: unknown; settings?: { name?: string } }): boolean {
  let changed = false;
  const data = loaded as { domains: Domain[]; domainAudit: unknown[] };
  if (!Array.isArray(data.domains)) {
    data.domains = [];
    changed = true;
  }
  if (!Array.isArray(data.domainAudit)) {
    data.domainAudit = [];
    changed = true;
  }

  const seen = new Map<string, Domain>();
  const unique: Domain[] = [];
  for (const raw of data.domains) {
    if (!raw || typeof raw !== "object") continue;
    raw.businessId ||= CURRENT_BUSINESS_ID;
    raw.tld ||= "se";
    raw.source ||= "purchased";
    raw.registrarProvider ||= "mock";
    raw.status ||= "failed";
    raw.autoRenew ??= true;
    raw.verificationStatus ||= "pending";
    raw.sslStatus ||= "pending";
    raw.provisioning = { ...emptyProvisioning(), ...raw.provisioning };
    raw.billing = { ...emptyBilling(), ...raw.billing };
    raw.idempotencyKey ||= `legacy:${raw.id}`;
    raw.createdAt ||= new Date().toISOString();
    raw.updatedAt ||= raw.createdAt;
    raw.hostname = String(raw.hostname ?? "").toLowerCase();
    if (!raw.hostname) continue;
    const prev = seen.get(raw.hostname);
    if (prev) {
      // Unik hostname: behåll den äldsta, strunta i dubbletter.
      continue;
    }
    seen.set(raw.hostname, raw);
    unique.push(raw);
  }
  if (unique.length !== data.domains.length) {
    data.domains = unique;
    changed = true;
  }
  return changed;
}
