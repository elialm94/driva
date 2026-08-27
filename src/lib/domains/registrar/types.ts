import type { DomainTld } from "../../types";
import type { RegistrantProfile } from "../profile";

export interface DomainPrice {
  currency: "SEK";
  customerPrice: number;
  purchasePrice: number;
  periodYears: number;
}

export interface AvailabilityResult {
  hostname: string;
  tld: DomainTld;
  available: boolean;
  price?: DomainPrice;
}

export interface RegistrantHandle {
  id: string;
}

export interface RegisteredDomain {
  registrarDomainId: string;
  hostname: string;
  registeredAt: string;
  expiresAt: string;
}

export interface DomainRegistrarStatus {
  hostname: string;
  status: "pending" | "active" | "expired" | "failed";
  expiresAt?: string;
  nameservers?: string[];
}

export interface DomainRegistrarProvider {
  readonly id: "openprovider" | "mock";
  checkAvailability(hostname: string, tld: DomainTld): Promise<AvailabilityResult>;
  getPrice(tld: DomainTld): Promise<DomainPrice>;
  createRegistrant(profile: RegistrantProfile, idempotencyKey: string): Promise<RegistrantHandle>;
  registerDomain(input: {
    hostname: string;
    tld: DomainTld;
    registrantId: string;
    periodYears: number;
    idempotencyKey: string;
  }): Promise<RegisteredDomain>;
  renewDomain(hostname: string, periodYears: number): Promise<{ expiresAt: string }>;
  getDomainStatus(hostname: string): Promise<DomainRegistrarStatus>;
  configureNameservers(hostname: string, nameservers: string[]): Promise<void>;
  cancelAutoRenew(hostname: string): Promise<void>;
}
