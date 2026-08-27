import type { DomainTld } from "../../types";
import { registrarConfig, SE_CUSTOMER_PRICE, SE_PURCHASE_PRICE } from "../config";
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

/**
 * Openprovider reseller-API för .se.
 * Credentials läses bara server-side. Misslyckas anropet mappas det till en
 * mänsklig felkategori – aldrig rå API-text eller lösenord.
 */
export class OpenproviderDomainRegistrar implements DomainRegistrarProvider {
  readonly id = "openprovider" as const;

  private token: string | null = null;

  private cfg() {
    return registrarConfig();
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const cfg = this.cfg();
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    let res: Response;
    try {
      res = await fetch(`${cfg.apiUrl}${path}`, { ...init, headers });
    } catch {
      throw new DomainError("registrar_failed", "Kunde inte nå registret just nu. Försök igen om en stund.");
    }
    if (res.status === 401 && path !== "/v1beta/auth/login") {
      this.token = null;
      await this.ensureToken();
      return this.request<T>(path, init);
    }
    if (!res.ok) {
      throw new DomainError("registrar_failed", "Registret kunde inte slutföra begäran. Inget mer hände.");
    }
    return (await res.json()) as T;
  }

  private async ensureToken(): Promise<void> {
    if (this.token) return;
    const cfg = this.cfg();
    if (!cfg.username || !cfg.password) {
      throw new DomainError("registrar_failed", "Domäntjänsten är inte konfigurerad.");
    }
    const body = await this.request<{ data?: { token?: string } }>("/v1beta/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: cfg.username, password: cfg.password }),
    });
    const token = body.data?.token;
    if (!token) throw new DomainError("registrar_failed", "Kunde inte ansluta till registret.");
    this.token = token;
  }

  async checkAvailability(hostname: string, tld: DomainTld): Promise<AvailabilityResult> {
    await this.ensureToken();
    const name = hostname.slice(0, -(tld.length + 1));
    const body = await this.request<{ data?: { results?: { status?: string }[] } }>("/v1beta/domains/check", {
      method: "POST",
      body: JSON.stringify({ domains: [{ name, extension: tld }] }),
    });
    const status = body.data?.results?.[0]?.status ?? "";
    const available = status === "free" || status === "available";
    return {
      hostname,
      tld,
      available,
      price: available ? await this.getPrice(tld) : undefined,
    };
  }

  async getPrice(_tld: DomainTld): Promise<DomainPrice> {
    return {
      currency: "SEK",
      customerPrice: SE_CUSTOMER_PRICE,
      purchasePrice: SE_PURCHASE_PRICE,
      periodYears: 1,
    };
  }

  async createRegistrant(profile: RegistrantProfile, idempotencyKey: string): Promise<RegistrantHandle> {
    await this.ensureToken();
    const nameParts = profile.companyName.replace(/\s*AB$/i, "").trim().split(/\s+/);
    const body = await this.request<{ data?: { handle?: string } }>("/v1beta/customers", {
      method: "POST",
      headers: { "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({
        company_name: profile.companyName,
        name: {
          first_name: nameParts[0] || "Företag",
          last_name: nameParts.slice(1).join(" ") || "AB",
        },
        address: {
          street: profile.address,
          zipcode: profile.postalCode.replace(/\s/g, ""),
          city: profile.city,
          country: "SE",
        },
        phone: { country_code: "+46", area_code: "", subscriber_number: profile.phone.replace(/\D/g, "") },
        email: profile.email,
        additional_data: { company_registration_number: profile.orgNumber.replace(/\D/g, "") },
      }),
    });
    const id = body.data?.handle;
    if (!id) throw new DomainError("registrar_failed", "Kunde inte spara företagsuppgifterna hos registret.");
    return { id };
  }

  async registerDomain(input: {
    hostname: string;
    tld: DomainTld;
    registrantId: string;
    periodYears: number;
    idempotencyKey: string;
  }): Promise<RegisteredDomain> {
    await this.ensureToken();
    const name = input.hostname.slice(0, -(input.tld.length + 1));
    const body = await this.request<{ data?: { id?: number | string } }>("/v1beta/domains", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        domain: { name, extension: input.tld },
        period: input.periodYears,
        owner_handle: input.registrantId,
        admin_handle: input.registrantId,
        tech_handle: input.registrantId,
        autorenew: "on",
      }),
    });
    const id = body.data?.id;
    if (id == null) throw new DomainError("registrar_failed", "Domänen kunde inte registreras just nu.");
    const now = new Date();
    const expires = new Date(now);
    expires.setFullYear(expires.getFullYear() + input.periodYears);
    return {
      registrarDomainId: String(id),
      hostname: input.hostname,
      registeredAt: now.toISOString(),
      expiresAt: expires.toISOString(),
    };
  }

  async renewDomain(hostname: string, periodYears: number): Promise<{ expiresAt: string }> {
    await this.ensureToken();
    const [name, ext] = hostname.split(".");
    await this.request(`/v1beta/domains/${name}.${ext}/renew`, {
      method: "POST",
      body: JSON.stringify({ period: periodYears }),
    });
    const expires = new Date();
    expires.setFullYear(expires.getFullYear() + periodYears);
    return { expiresAt: expires.toISOString() };
  }

  async getDomainStatus(hostname: string): Promise<DomainRegistrarStatus> {
    await this.ensureToken();
    const [name, ext] = hostname.split(".");
    const body = await this.request<{ data?: { status?: string; expiry_date?: string; name_servers?: { name: string }[] } }>(
      `/v1beta/domains/${name}.${ext}`,
    );
    const status = body.data?.status === "ACT" ? "active" : "pending";
    return {
      hostname,
      status,
      expiresAt: body.data?.expiry_date,
      nameservers: body.data?.name_servers?.map((n) => n.name),
    };
  }

  async configureNameservers(hostname: string, nameservers: string[]): Promise<void> {
    await this.ensureToken();
    const [name, ext] = hostname.split(".");
    await this.request(`/v1beta/domains/${name}.${ext}`, {
      method: "PUT",
      body: JSON.stringify({
        name_servers: nameservers.map((n) => ({ name: n })),
      }),
    });
  }

  async cancelAutoRenew(hostname: string): Promise<void> {
    await this.ensureToken();
    const [name, ext] = hostname.split(".");
    await this.request(`/v1beta/domains/${name}.${ext}`, {
      method: "PUT",
      body: JSON.stringify({ autorenew: "off" }),
    });
  }
}
