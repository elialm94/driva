import { vercelHostingConfig } from "../config";
import { DomainError } from "../errors";
import { VERCEL_FALLBACK_A, VERCEL_FALLBACK_CNAME, VERCEL_FALLBACK_NS } from "./types";
import type { DnsRecordInstruction, HostingDomainStatus, HostingProvider } from "./types";

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Kopplar kunders .se-adresser till Vercel-projektet `driva`
 * (https://driva-alpha.vercel.app/), inte leftover-projektet noxfort.
 */
export class VercelHostingProvider implements HostingProvider {
  readonly id = "vercel" as const;

  private cfg() {
    const c = vercelHostingConfig();
    if (!c.token) throw new DomainError("hosting_failed", "Hemsidan kunde inte kopplas just nu.");
    return c;
  }

  private url(path: string): string {
    const { teamId } = this.cfg();
    const base = `https://api.vercel.com${path}`;
    return teamId ? `${base}${path.includes("?") ? "&" : "?"}teamId=${encodeURIComponent(teamId)}` : base;
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const { token } = this.cfg();
    let res: Response;
    try {
      res = await fetch(this.url(path), {
        ...init,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
          ...(init.headers as Record<string, string> | undefined),
        },
      });
    } catch {
      throw new DomainError("hosting_failed", "Hemsidan kunde inte kopplas just nu.");
    }
    if (!res.ok) {
      throw new DomainError("hosting_failed", "Hemsidan kunde inte kopplas. Domänen är din – prova igen.");
    }
    return (await res.json()) as T;
  }

  async addCustomDomain(hostname: string, _idempotencyKey: string): Promise<HostingDomainStatus> {
    const { project } = this.cfg();
    try {
      await this.request(`/v10/projects/${encodeURIComponent(project)}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: hostname }),
      });
    } catch (e) {
      // Idempotent: redan tillagd räknas som ok.
      if (!(e instanceof DomainError)) throw e;
    }
    try {
      await this.request(`/v10/projects/${encodeURIComponent(project)}/domains`, {
        method: "POST",
        body: JSON.stringify({ name: `www.${hostname.replace(/^www\./, "")}` }),
      });
    } catch {
      // www kan redan finnas.
    }
    return this.readStatus(hostname);
  }

  async requiredDns(hostname: string): Promise<DnsRecordInstruction[]> {
    const status = await this.readStatus(hostname);
    return status.requiredRecords;
  }

  async nameservers(): Promise<string[]> {
    return [...VERCEL_FALLBACK_NS];
  }

  async verifyDomain(hostname: string): Promise<HostingDomainStatus> {
    const { project } = this.cfg();
    try {
      await this.request(`/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}/verify`, {
        method: "POST",
      });
    } catch {
      // Inte verifierad än är ett vänteläge, inte ett hårt fel.
    }
    return this.readStatus(hostname);
  }

  async sslStatus(hostname: string): Promise<{ ready: boolean }> {
    const s = await this.readStatus(hostname);
    return { ready: s.sslReady };
  }

  private async readStatus(hostname: string): Promise<HostingDomainStatus> {
    const { project } = this.cfg();
    type VercelDomain = {
      verified?: boolean;
      verification?: { type?: string; domain?: string; value?: string }[];
      intendedNameservers?: string[];
    };
    const body = await this.request<VercelDomain>(
      `/v9/projects/${encodeURIComponent(project)}/domains/${encodeURIComponent(hostname)}`,
    );
    const ns = body.intendedNameservers?.length ? body.intendedNameservers : [...VERCEL_FALLBACK_NS];
    const requiredRecords: DnsRecordInstruction[] = [];
    for (const rec of body.verification ?? []) {
      if (rec.value) {
        requiredRecords.push({
          type: (rec.type?.toUpperCase() as DnsRecordInstruction["type"]) || "TXT",
          host: rec.domain || hostname,
          value: rec.value,
          purpose: "verify",
        });
      }
    }
    if (requiredRecords.length === 0) {
      requiredRecords.push(
        { type: "A", host: "@", value: VERCEL_FALLBACK_A, purpose: "apex" },
        { type: "CNAME", host: "www", value: VERCEL_FALLBACK_CNAME, purpose: "www" },
      );
    }
    return {
      hostname,
      verified: Boolean(body.verified),
      sslReady: Boolean(body.verified),
      nameservers: ns,
      requiredRecords,
    };
  }
}
