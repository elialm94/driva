/**
 * Val av bankleverantör per request.
 *
 *   demo (isDemoMode | isDemoBusiness | JSON-lagret)  → MockBankProvider (noll HTTP)
 *   riktigt företag + komplett TINK_*-miljö           → LiveTinkProvider
 *   riktigt företag utan miljö                        → UnconfiguredBankProvider
 *
 * Måste anropas i tenantkontext (withBusiness) – isDemoBusiness läser
 * db().meta.demo för det aktiva företaget.
 */
import { isDemoBusiness, isDemoMode, isJsonDemoStore } from "../demo";
import type { BankProvider } from "./provider";
import { MockBankProvider } from "./providers/mock";
import { LiveTinkProvider } from "./providers/tink";
import { UnconfiguredBankProvider } from "./providers/unconfigured";
import { readTinkConfig } from "./tink/config";

export type BankProviderKind = "mock" | "tink" | "unconfigured";

/** Ren beslutsfunktion – testbar utan miljö eller store. */
export function resolveBankProviderKind(input: { demo: boolean; configured: boolean }): BankProviderKind {
  if (input.demo) return "mock";
  return input.configured ? "tink" : "unconfigured";
}

/** Är den aktuella requesten demo? (Miljö, demoföretag eller JSON-lagret.) */
export function isDemoBankRequest(): boolean {
  return isDemoMode() || isDemoBusiness() || isJsonDemoStore();
}

export function bankProviderKind(env: Record<string, string | undefined> = process.env): BankProviderKind {
  return resolveBankProviderKind({ demo: isDemoBankRequest(), configured: readTinkConfig(env) !== null });
}

export function selectBankProvider(env: Record<string, string | undefined> = process.env): BankProvider {
  const kind = bankProviderKind(env);
  if (kind === "mock") return new MockBankProvider();
  if (kind === "tink") return new LiveTinkProvider(readTinkConfig(env)!);
  return new UnconfiguredBankProvider();
}
