import { domainRuntimeMode, registrarConfig } from "../config";
import { MockDomainRegistrar } from "./mock";
import { OpenproviderDomainRegistrar } from "./openprovider";
import type { DomainRegistrarProvider } from "./types";

let cached: DomainRegistrarProvider | null = null;

export function getDomainRegistrar(): DomainRegistrarProvider {
  if (cached) return cached;
  if (domainRuntimeMode() === "mock") {
    cached = new MockDomainRegistrar();
    return cached;
  }
  const { provider, username, password } = registrarConfig();
  if (!username || !password || provider === "mock") {
    cached = new MockDomainRegistrar();
    return cached;
  }
  cached = new OpenproviderDomainRegistrar();
  return cached;
}

/** Testkrok – nollställer cache så nästa anrop bygger om providern. */
export function resetRegistrarCache(): void {
  cached = null;
}

export type { DomainRegistrarProvider } from "./types";
