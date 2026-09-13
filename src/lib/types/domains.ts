/**
 * Egen .se-adress: köp, provisionering och domänaudit.
 *
 * Del av domänmodellen. Importera via barrelen `@/lib/types`.
 */

import type { ID } from "./common";

/* ---------------------------------- Domän ---------------------------------- */

/** V1: endast .se. Fler TLD:er kan läggas till utan att byta modell. */
export type DomainTld = "se";

export type DomainStatus =
  | "checking"
  | "available"
  | "purchasing"
  | "registering"
  | "registered"
  | "configuring"
  | "verifying"
  | "active"
  | "failed"
  | "expired";

export type DomainSource = "purchased" | "existing";

export type DomainBillingStatus = "pending" | "paid" | "failed" | "renewal_failed";

export type DomainSslStatus = "pending" | "active" | "failed";

export type DomainVerificationStatus = "pending" | "verified" | "failed";

export type DomainErrorCategory =
  | "profile_incomplete"
  | "unavailable"
  | "payment_failed"
  | "registrar_failed"
  | "hosting_failed"
  | "dns_pending"
  | "ssl_pending"
  | "validation"
  | "conflict";

export type DomainRegistrarProviderId = "openprovider" | "mock";

export interface DomainBilling {
  customerPrice: number;
  purchasePrice: number;
  currency: "SEK";
  purchasedAt?: string;
  renewsAt?: string;
  autoRenew: boolean;
  status: DomainBillingStatus;
  chargeId?: string;
  idempotencyKey: string;
}

export type DomainProvisioningStep =
  | "profile"
  | "availability"
  | "billing"
  | "registrant"
  | "register"
  | "nameservers"
  | "hosting"
  | "dns"
  | "ssl"
  | "done";

export interface DomainProvisioning {
  step: DomainProvisioningStep;
  billed: boolean;
  registered: boolean;
  registrantCreated: boolean;
  nameserversConfigured: boolean;
  hostingAttached: boolean;
  dnsVerified: boolean;
  sslReady: boolean;
  /** Antal poll-tick, används av mock för att simulera väntan. */
  ticks: number;
  lastError?: { category: DomainErrorCategory; message: string; at: string };
}

export interface Domain {
  id: ID;
  /** En-tenant i V1: alltid aktuellt företag. Fältet finns för att blockera cross-tenant takeover. */
  businessId: ID;
  websiteId?: ID;
  hostname: string;
  tld: DomainTld;
  source: DomainSource;
  registrarProvider: DomainRegistrarProviderId;
  registrarDomainId?: string;
  registrarRegistrantId?: string;
  status: DomainStatus;
  isPrimary: boolean;
  registeredAt?: string;
  expiresAt?: string;
  autoRenew: boolean;
  verificationStatus: DomainVerificationStatus;
  sslStatus: DomainSslStatus;
  billing: DomainBilling;
  provisioning: DomainProvisioning;
  idempotencyKey: string;
  createdAt: string;
  updatedAt: string;
}

export type DomainAuditAction =
  | "domain_searched"
  | "domain_purchase_started"
  | "domain_paid"
  | "domain_payment_failed"
  | "domain_registrant_created"
  | "domain_registered"
  | "domain_register_failed"
  | "domain_nameservers_set"
  | "domain_hosting_attached"
  | "domain_hosting_failed"
  | "domain_dns_verified"
  | "domain_ssl_active"
  | "domain_active"
  | "domain_failed"
  | "domain_retry"
  | "domain_autorenew_changed"
  | "domain_renewal_failed"
  | "domain_existing_started"
  | "domain_existing_verified";

export interface DomainAuditEvent {
  id: ID;
  at: string;
  actor: "anvandare" | "assistent" | "system";
  action: DomainAuditAction;
  domainId?: ID;
  hostname?: string;
  details: string;
}
