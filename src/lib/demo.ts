import { storageMode } from "./storage/config";
import { db } from "./store";

/**
 * Demo-/utvecklingsgrind för alla FIKTIVA pengaflöden.
 *
 * Funktioner som hittar på banktransaktioner, saldon eller betalningar
 * (simulateIncomingPayment, paySupplierInvoice, BankID-simulering,
 * ROT-utbetalningsdemo) får ALDRIG vara nåbara för
 * riktiga företag i produktion. Grinden är en servergrind – inte bara UI.
 *
 * Två vägar in i demoläget:
 *   * Miljön (isDemoMode): utveckling/test, eller explicit DRIVA_DEMO=1.
 *   * Företaget (isDemoBusiness): det publika demoföretaget i produktion –
 *     businesses.is_demo (fryst vid insert) speglas till db().meta.demo vid
 *     laddning. Riktiga företag i samma produktion förblir spärrade.
 *
 * Produktion utan bankkoppling ska visa ett ärligt oconfigurerat läge
 * ("Bankkoppling är inte konfigurerad"), aldrig fejkad framgång.
 */
export function isDemoMode(): boolean {
  // Explicit opt-in fungerar överallt (t.ex. hela miljön som demo).
  if (process.env.DRIVA_DEMO === "1") return true;
  // Explicit avstängd demo, t.ex. för att testa produktionsbeteende lokalt.
  if (process.env.DRIVA_DEMO === "0") return false;
  // Produktion är aldrig demo av sig själv.
  if (process.env.NODE_ENV === "production") return false;
  // Utveckling/test: JSON-läget är per definition demo; lokal Supabase också OK.
  return true;
}

/** Är det lokala JSON-lagret aktivt? (Alltid demo.) */
export function isJsonDemoStore(): boolean {
  return storageMode() === "json";
}

/**
 * Är requestens AKTIVA företag det publika demoföretaget? Läser tenant-
 * tillståndets meta.demo (från businesses.is_demo – aldrig klientpåståenden).
 * Utanför tenantkontext, och för alla riktiga företag: false.
 *
 * Detta är vakten för externa sidoeffekter i produktion (riktiga mejl,
 * AI-kostnadstak): det lokala JSON-läget påverkas INTE av den – där gäller
 * utvecklarens egen miljökonfiguration precis som tidigare.
 */
export function isDemoBusiness(): boolean {
  try {
    return db().meta.demo === true;
  } catch {
    return false;
  }
}

export class DemoModeError extends Error {
  constructor(feature: string) {
    super(
      `${feature} är en demofunktion och är avstängd i den här miljön. ` +
        `Bankkoppling är inte konfigurerad – anslut en riktig bank för att hantera betalningar.`
    );
    this.name = "DemoModeError";
  }
}

/** Kasta ärligt fel om en demofunktion nås utanför demo-läge/demoföretaget. */
export function assertDemoMode(feature: string): void {
  if (isDemoMode()) return;
  if (isDemoBusiness()) return;
  throw new DemoModeError(feature);
}
