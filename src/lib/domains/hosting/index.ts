import { domainRuntimeMode, vercelHostingConfig } from "../config";
import { MockHostingProvider } from "./mock";
import { VercelHostingProvider } from "./vercel";
import type { HostingProvider } from "./types";

let cached: HostingProvider | null = null;

export function getHostingProvider(): HostingProvider {
  if (cached) return cached;
  if (domainRuntimeMode() === "mock") {
    cached = new MockHostingProvider();
    return cached;
  }
  if (!vercelHostingConfig().token) {
    cached = new MockHostingProvider();
    return cached;
  }
  cached = new VercelHostingProvider();
  return cached;
}

export function resetHostingCache(): void {
  cached = null;
}

export type { HostingProvider, DnsRecordInstruction, HostingDomainStatus } from "./types";
