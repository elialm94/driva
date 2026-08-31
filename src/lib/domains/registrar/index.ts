import { registrarConfig } from "../config";
import { effectiveDomainRuntimeMode } from "../mode";
import { MockDomainRegistrar } from "./mock";
import { OpenproviderDomainRegistrar } from "./openprovider";
import type { DomainRegistrarProvider } from "./types";

let cached: DomainRegistrarProvider | null = null;
// Demosessionens företag får ALLTID mock – utvärderas per anrop (aldrig
// cachat) så att en demo-request i produktion inte kan nå den riktiga
// registrar-providern, och vice versa.
let mockFallback: MockDomainRegistrar | null = null;

function mockRegistrar(): MockDomainRegistrar {
  if (!mockFallback) mockFallback = new MockDomainRegistrar();
  return mockFallback;
}

export function getDomainRegistrar(): DomainRegistrarProvider {
  if (effectiveDomainRuntimeMode() === "mock") return mockRegistrar();
  if (cached) return cached;
  const { provider, username, password } = registrarConfig();
  if (!username || !password || provider === "mock") {
    cached = mockRegistrar();
    return cached;
  }
  cached = new OpenproviderDomainRegistrar();
  return cached;
}

/** Testkrok – nollställer cache så nästa anrop bygger om providern. */
export function resetRegistrarCache(): void {
  cached = null;
  mockFallback = null;
}

export type { DomainRegistrarProvider } from "./types";
