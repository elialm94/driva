import { vercelHostingConfig } from "../config";
import { effectiveDomainRuntimeMode } from "../mode";
import { MockHostingProvider } from "./mock";
import { VercelHostingProvider } from "./vercel";
import type { HostingProvider } from "./types";

let cached: HostingProvider | null = null;
// Demoföretag får ALLTID mock – per anrop, aldrig cachat (se registrar/index).
let mockFallback: MockHostingProvider | null = null;

function mockHosting(): MockHostingProvider {
  if (!mockFallback) mockFallback = new MockHostingProvider();
  return mockFallback;
}

export function getHostingProvider(): HostingProvider {
  if (effectiveDomainRuntimeMode() === "mock") return mockHosting();
  if (cached) return cached;
  if (!vercelHostingConfig().token) {
    cached = mockHosting();
    return cached;
  }
  cached = new VercelHostingProvider();
  return cached;
}

export function resetHostingCache(): void {
  cached = null;
  mockFallback = null;
}

export type { HostingProvider, DnsRecordInstruction, HostingDomainStatus } from "./types";
