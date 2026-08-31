import { isDemoBusiness } from "../demo";
import { domainRuntimeMode, type DomainRuntimeMode } from "./config";

/**
 * Demosessionens domänflöden är ALLTID mock – även i produktion där riktiga
 * registrar-/hostinguppgifter finns i miljön. Ett demoföretag får aldrig
 * köpa en riktig domän eller röra riktig DNS; flödet visar samma steg och
 * timeline men mot mock-providern.
 *
 * Ligger i en egen modul (inte config.ts): config importeras av store-kedjan
 * och isDemoBusiness läser store – en import därifrån vore cirkulär.
 */
export function effectiveDomainRuntimeMode(): DomainRuntimeMode {
  return isDemoBusiness() ? "mock" : domainRuntimeMode();
}

export function isEffectiveMockDomainMode(): boolean {
  return effectiveDomainRuntimeMode() === "mock";
}
