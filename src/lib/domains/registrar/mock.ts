import type { DomainTld } from "../../types";
import { SE_CUSTOMER_PRICE, SE_PURCHASE_PRICE } from "../config";
import { DomainError } from "../errors";
import type { RegistrantProfile } from "../profile";
import type {
  AvailabilityResult,
  DomainPrice,
  DomainRegistrarProvider,
  DomainRegistrarStatus,
  RegisteredDomain,
  RegistrantHandle,
} from "./types";

const TAKEN = new Set(["google.se", "ikea.se", "spotify.se", "upptagen.se", "telia.se"]);

const registrants = new Map<string, string>();
const registered = new Map<string, RegisteredDomain & { nameservers: string[]; autoRenew: boolean }>();

export function resetMockRegistrar(): void {
  registrants.clear();
  registered.clear();
}

export function mockTakenHostnames(): Set<string> {
  return new Set(TAKEN);
}

function price(): DomainPrice {
  return { currency: "SEK", customerPrice: SE_CUSTOMER_PRICE, purchasePrice: SE_PURCHASE_PRICE, periodYears: 1 };
}

function yearsFromNow(years: number): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

export class MockDomainRegistrar implements DomainRegistrarProvider {
  readonly id = "mock" as const;

  async checkAvailability(hostname: string, tld: DomainTld): Promise<AvailabilityResult> {
    const available = !TAKEN.has(hostname);
    return { hostname, tld, available, price: available ? price() : undefined };
  }

  async getPrice(_tld: DomainTld): Promise<DomainPrice> {
    return price();
  }

  async createRegistrant(profile: RegistrantProfile, idempotencyKey: string): Promise<RegistrantHandle> {
    const existing = registrants.get(idempotencyKey);
    if (existing) return { id: existing };
    const id = `reg-${profile.orgNumber.replace(/\D/g, "") || "x"}`;
    registrants.set(idempotencyKey, id);
    return { id };
  }

  async registerDomain(input: {
    hostname: string;
    tld: DomainTld;
    registrantId: string;
    periodYears: number;
    idempotencyKey: string;
  }): Promise<RegisteredDomain> {
    const existing = registered.get(input.hostname);
    if (existing) return existing;
    if (input.hostname.startsWith("fail-register")) {
      throw new DomainError("registrar_failed", "Domänen kunde inte registreras just nu. Inget mer hände.");
    }
    const rec: RegisteredDomain & { nameservers: string[]; autoRenew: boolean } = {
      registrarDomainId: `op-${input.idempotencyKey.slice(0, 12)}`,
      hostname: input.hostname,
      registeredAt: new Date().toISOString(),
      expiresAt: yearsFromNow(input.periodYears),
      nameservers: [],
      autoRenew: true,
    };
    registered.set(input.hostname, rec);
    return rec;
  }

  async renewDomain(hostname: string, periodYears: number): Promise<{ expiresAt: string }> {
    const rec = registered.get(hostname);
    if (!rec) throw new DomainError("registrar_failed", "Domänen hittades inte hos registret.");
    const next = new Date(rec.expiresAt);
    next.setFullYear(next.getFullYear() + periodYears);
    rec.expiresAt = next.toISOString();
    return { expiresAt: rec.expiresAt };
  }

  async getDomainStatus(hostname: string): Promise<DomainRegistrarStatus> {
    const rec = registered.get(hostname);
    if (!rec) return { hostname, status: "pending" };
    return { hostname, status: "active", expiresAt: rec.expiresAt, nameservers: rec.nameservers };
  }

  async configureNameservers(hostname: string, nameservers: string[]): Promise<void> {
    const rec = registered.get(hostname);
    if (!rec) throw new DomainError("registrar_failed", "Domänen hittades inte hos registret.");
    rec.nameservers = nameservers;
  }

  async cancelAutoRenew(hostname: string): Promise<void> {
    const rec = registered.get(hostname);
    if (rec) rec.autoRenew = false;
  }
}
