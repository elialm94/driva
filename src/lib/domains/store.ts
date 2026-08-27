import { db, save } from "../store";
import type { Domain } from "../types";
import { CURRENT_BUSINESS_ID } from "./config";
import { DomainError } from "./errors";
import { apexOf, wwwAlias } from "./hostname";

export function currentBusinessId(): string {
  return CURRENT_BUSINESS_ID;
}

export function allDomains(): Domain[] {
  return db().domains ?? [];
}

export function domainsForBusiness(businessId = currentBusinessId()): Domain[] {
  return allDomains().filter((d) => d.businessId === businessId);
}

export function getDomain(id: string): Domain | undefined {
  return allDomains().find((d) => d.id === id);
}

export function requireOwnedDomain(id: string, businessId = currentBusinessId()): Domain {
  const domain = getDomain(id);
  if (!domain || domain.businessId !== businessId) {
    throw new DomainError("conflict", "Domänen hittades inte.");
  }
  return domain;
}

export function findDomainByHostname(hostname: string): Domain | undefined {
  const apex = apexOf(hostname.toLowerCase());
  const www = wwwAlias(apex);
  return allDomains().find((d) => d.hostname === apex || d.hostname === www || wwwAlias(d.hostname) === hostname);
}

export function assertHostnameAvailableToBusiness(hostname: string, businessId = currentBusinessId()): void {
  const existing = findDomainByHostname(hostname);
  if (!existing) return;
  if (existing.businessId !== businessId) {
    throw new DomainError("conflict", "Den adressen är redan kopplad.");
  }
}

export function primaryDomain(businessId = currentBusinessId()): Domain | undefined {
  const list = domainsForBusiness(businessId);
  return list.find((d) => d.isPrimary) ?? list[0];
}

export function touchDomain(domain: Domain): void {
  domain.updatedAt = new Date().toISOString();
  save();
}
