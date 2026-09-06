/**
 * Val av inlämningsleverantör per request. Samma mönster som bankkopplingen i
 * banking/select.ts – en abstraktion, inte två.
 *
 *   demo (isDemoMode | isDemoBusiness | JSON-lagret)  → MockFilingProvider (noll HTTP)
 *   riktigt företag + komplett FILING_API_*           → LiveFilingProvider
 *   riktigt företag utan avtalsuppgifter              → UnconfiguredFilingProvider
 *
 * Måste anropas i tenantkontext (withBusiness) – isDemoBusiness läser
 * db().meta.demo för det aktiva företaget.
 */
import { isDemoBusiness, isDemoMode, isJsonDemoStore } from "../demo";
import { readFilingConfig } from "./config";
import type { FilingProvider } from "./provider";
import { MockFilingProvider } from "./providers/mock";
import { LiveFilingProvider } from "./providers/live";
import { UnconfiguredFilingProvider } from "./providers/unconfigured";

export type FilingProviderKind = "mock" | "live" | "unconfigured";

/** Ren beslutsfunktion – testbar utan miljö eller store. */
export function resolveFilingProviderKind(input: { demo: boolean; configured: boolean }): FilingProviderKind {
  if (input.demo) return "mock";
  return input.configured ? "live" : "unconfigured";
}

/** Är den aktuella requesten demo? (Miljö, demoföretag eller JSON-lagret.) */
export function isDemoFilingRequest(): boolean {
  return isDemoMode() || isDemoBusiness() || isJsonDemoStore();
}

export function filingProviderKind(env: Record<string, string | undefined> = process.env): FilingProviderKind {
  return resolveFilingProviderKind({ demo: isDemoFilingRequest(), configured: readFilingConfig(env) !== null });
}

export function selectFilingProvider(env: Record<string, string | undefined> = process.env): FilingProvider {
  const kind = filingProviderKind(env);
  if (kind === "mock") return new MockFilingProvider();
  if (kind === "live") return new LiveFilingProvider(readFilingConfig(env)!);
  return new UnconfiguredFilingProvider();
}

/** Går det att lämna in maskinellt härifrån? Styr om knappen visas i UI:t. */
export function filingSubmissionAvailable(env: Record<string, string | undefined> = process.env): boolean {
  return filingProviderKind(env) !== "unconfigured";
}
