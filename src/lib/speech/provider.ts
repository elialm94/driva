import type { SpeechToTextProvider } from "./types";
import { createWebSpeechProvider } from "./web-speech";

/**
 * Test-/utvecklingskrok: i icke-produktion kan ett verifieringspass injicera
 * en deterministisk mockleverantör via window.__drivaSpeechProvider – eller
 * null för att simulera "stöds ej" (mikrofonen ska döljas helt). Grenen
 * elimineras i produktionsbyggen (process.env.NODE_ENV är statiskt), så ingen
 * fejkad transkribering kan nå riktiga användare.
 */
export const SPEECH_PROVIDER_TEST_HOOK = "__drivaSpeechProvider";

/**
 * Kapabilitetskoll + leverantörsval. null ⇒ röstinmatning stöds inte i den
 * här webbläsaren (t.ex. Firefox) och mikrofonen ska inte renderas alls.
 */
export function resolveSpeechProvider(): SpeechToTextProvider | null {
  if (typeof window === "undefined") return null;
  if (process.env.NODE_ENV !== "production") {
    const injected = (window as unknown as Record<string, unknown>)[SPEECH_PROVIDER_TEST_HOOK];
    if (injected !== undefined) return injected as SpeechToTextProvider | null;
  }
  return createWebSpeechProvider(window);
}
