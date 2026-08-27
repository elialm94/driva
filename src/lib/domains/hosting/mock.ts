import { DomainError } from "../errors";
import { VERCEL_FALLBACK_A, VERCEL_FALLBACK_CNAME, VERCEL_FALLBACK_NS } from "./types";
import type { DnsRecordInstruction, HostingDomainStatus, HostingProvider } from "./types";

const attached = new Map<string, { ticks: number; failed: boolean }>();

export function resetMockHosting(): void {
  attached.clear();
}

function records(hostname: string): DnsRecordInstruction[] {
  return [
    { type: "A", host: "@", value: VERCEL_FALLBACK_A, purpose: "apex" },
    { type: "CNAME", host: "www", value: VERCEL_FALLBACK_CNAME, purpose: "www" },
    { type: "CNAME", host: hostname, value: VERCEL_FALLBACK_CNAME, purpose: "www" },
  ];
}

export class MockHostingProvider implements HostingProvider {
  readonly id = "mock" as const;

  async addCustomDomain(hostname: string, _idempotencyKey: string): Promise<HostingDomainStatus> {
    if (hostname.startsWith("fail-hosting")) {
      throw new DomainError("hosting_failed", "Hemsidan kunde inte kopplas. Domänen är din – prova igen.");
    }
    if (!attached.has(hostname)) attached.set(hostname, { ticks: 0, failed: false });
    return this.snapshot(hostname);
  }

  async requiredDns(hostname: string): Promise<DnsRecordInstruction[]> {
    return records(hostname);
  }

  async nameservers(): Promise<string[]> {
    return [...VERCEL_FALLBACK_NS];
  }

  async verifyDomain(hostname: string): Promise<HostingDomainStatus> {
    const rec = attached.get(hostname) ?? { ticks: 0, failed: false };
    rec.ticks += 1;
    attached.set(hostname, rec);
    return this.snapshot(hostname);
  }

  async sslStatus(hostname: string): Promise<{ ready: boolean }> {
    return { ready: this.snapshot(hostname).sslReady };
  }

  private snapshot(hostname: string): HostingDomainStatus {
    const rec = attached.get(hostname) ?? { ticks: 0, failed: false };
    const pendingDns = hostname.startsWith("pending-dns");
    const pendingSsl = hostname.startsWith("pending-https");
    const dnsVerified = !pendingDns && rec.ticks >= 1;
    const sslReady = dnsVerified && !pendingSsl;
    return {
      hostname,
      verified: dnsVerified,
      sslReady,
      nameservers: [...VERCEL_FALLBACK_NS],
      requiredRecords: records(hostname),
    };
  }
}
