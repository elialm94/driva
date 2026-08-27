import { db, save } from "../store";
import { uid } from "../ids";
import type { Domain } from "../types";
import { logActivity } from "../services/activity";
import { logDomainAudit } from "./audit";
import { getBillingProvider } from "./billing";
import { CURRENT_BUSINESS_ID, domainRuntimeMode, SE_CUSTOMER_PRICE, SE_PURCHASE_PRICE } from "./config";
import { DomainError } from "./errors";
import { parseHostnameInput } from "./hostname";
import { missingRegistrantFields } from "./profile";
import { getDomainRegistrar } from "./registrar";
import { assertHostnameAvailableToBusiness, currentBusinessId, findDomainByHostname } from "./store";
import { advanceProvisioning } from "./provisioning";

export function purchaseIdempotencyKey(hostname: string, businessId = currentBusinessId()): string {
  return `purchase:${businessId}:${hostname}`;
}

function emptyProvisioning(): Domain["provisioning"] {
  return {
    step: "availability",
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

export async function purchaseDomain(
  raw: string,
  opts: { idempotencyKey?: string; actor?: "anvandare" | "assistent" } = {},
): Promise<Domain> {
  const parsed = parseHostnameInput(raw);
  const missing = missingRegistrantFields();
  if (missing.length) {
    throw new DomainError("profile_incomplete", "En uppgift saknas innan domänen kan registreras");
  }

  const businessId = currentBusinessId();
  const key = opts.idempotencyKey || purchaseIdempotencyKey(parsed.hostname, businessId);
  const existingByKey = db().domains.find((d) => d.idempotencyKey === key);
  if (existingByKey) {
    await advanceProvisioning(existingByKey.id);
    return existingByKey;
  }

  assertHostnameAvailableToBusiness(parsed.hostname, businessId);
  const taken = findDomainByHostname(parsed.hostname);
  if (taken) throw new DomainError("conflict", "Den adressen är redan kopplad.");

  const registrar = getDomainRegistrar();
  const check = await registrar.checkAvailability(parsed.hostname, parsed.tld);
  if (!check.available) {
    throw new DomainError("unavailable", `${parsed.hostname} är inte ledig längre.`);
  }

  const now = new Date().toISOString();
  const websiteId = db().website?.id;
  const hasPrimary = db().domains.some((d) => d.businessId === businessId && d.isPrimary);
  const domain: Domain = {
    id: uid(),
    businessId: businessId || CURRENT_BUSINESS_ID,
    websiteId,
    hostname: parsed.hostname,
    tld: parsed.tld,
    source: "purchased",
    registrarProvider: domainRuntimeMode() === "mock" ? "mock" : registrar.id,
    status: "purchasing",
    isPrimary: !hasPrimary,
    autoRenew: true,
    verificationStatus: "pending",
    sslStatus: "pending",
    billing: {
      customerPrice: check.price?.customerPrice ?? SE_CUSTOMER_PRICE,
      purchasePrice: check.price?.purchasePrice ?? SE_PURCHASE_PRICE,
      currency: "SEK",
      autoRenew: true,
      status: "pending",
      idempotencyKey: `bill:${key}`,
    },
    provisioning: emptyProvisioning(),
    idempotencyKey: key,
    createdAt: now,
    updatedAt: now,
  };
  db().domains.push(domain);
  save();
  logDomainAudit("domain_purchase_started", `Köp av ${domain.hostname} påbörjat.`, {
    actor: opts.actor ?? "anvandare",
    domainId: domain.id,
    hostname: domain.hostname,
  });
  logActivity(`Köp av ${domain.hostname} påbörjades.`, { entity: { type: "doman", id: domain.id } });

  const billed = await getBillingProvider().charge({
    idempotencyKey: domain.billing.idempotencyKey,
    amount: domain.billing.customerPrice,
    currency: "SEK",
    description: `Domän ${domain.hostname}`,
    hostname: domain.hostname,
  });
  if (!billed.ok) {
    domain.billing.status = "failed";
    domain.status = "failed";
    domain.provisioning.lastError = {
      category: "payment_failed",
      message: "Betalningen gick inte igenom.",
      at: new Date().toISOString(),
    };
    save();
    logDomainAudit("domain_payment_failed", "Betalningen gick inte igenom.", {
      actor: opts.actor ?? "anvandare",
      domainId: domain.id,
      hostname: domain.hostname,
    });
    throw new DomainError("payment_failed", "Betalningen gick inte igenom. Domänen köptes inte.");
  }

  domain.billing.status = "paid";
  domain.billing.chargeId = billed.chargeId;
  domain.billing.purchasedAt = new Date().toISOString();
  domain.provisioning.billed = true;
  domain.provisioning.step = "registrant";
  save();
  logDomainAudit("domain_paid", `Betalning för ${domain.hostname} registrerad.`, {
    actor: opts.actor ?? "system",
    domainId: domain.id,
    hostname: domain.hostname,
  });

  await advanceProvisioning(domain.id);
  return domain;
}
