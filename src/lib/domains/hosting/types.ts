export interface DnsRecordInstruction {
  type: "CNAME" | "A" | "AAAA" | "TXT" | "NS";
  host: string;
  value: string;
  purpose: "apex" | "www" | "verify";
}

export interface HostingDomainStatus {
  hostname: string;
  verified: boolean;
  sslReady: boolean;
  nameservers: string[];
  requiredRecords: DnsRecordInstruction[];
}

export interface HostingProvider {
  readonly id: "vercel" | "mock";
  addCustomDomain(hostname: string, idempotencyKey: string): Promise<HostingDomainStatus>;
  requiredDns(hostname: string): Promise<DnsRecordInstruction[]>;
  nameservers(): Promise<string[]>;
  verifyDomain(hostname: string): Promise<HostingDomainStatus>;
  sslStatus(hostname: string): Promise<{ ready: boolean }>;
}

/** Standardvärden från Vercel – används bara om API:t inte returnerar egna. */
export const VERCEL_FALLBACK_NS = ["ns1.vercel-dns.com", "ns2.vercel-dns.com"];
export const VERCEL_FALLBACK_CNAME = "cname.vercel-dns.com";
export const VERCEL_FALLBACK_A = "76.76.21.21";
