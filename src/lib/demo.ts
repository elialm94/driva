import { storageMode } from "./storage/config";

/**
 * Demo-/utvecklingsgrind för alla FIKTIVA pengaflöden.
 *
 * Funktioner som hittar på banktransaktioner, saldon eller betalningar
 * (simulateIncomingPayment, paySupplierInvoice, uploadStandaloneReceipt,
 * BankID-simulering, ROT-utbetalningsdemo) får ALDRIG vara nåbara i en riktig
 * produktionsmiljö. Grinden är en servergrind (miljökontroll) – inte bara UI.
 *
 * Produktion utan bankkoppling ska visa ett ärligt oconfigurerat läge
 * ("Bankkoppling är inte konfigurerad"), aldrig fejkad framgång.
 */
export function isDemoMode(): boolean {
  // Explicit opt-in fungerar överallt (t.ex. demo-tenant i produktion).
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

export class DemoModeError extends Error {
  constructor(feature: string) {
    super(
      `${feature} är en demofunktion och är avstängd i den här miljön. ` +
        `Bankkoppling är inte konfigurerad – anslut en riktig bank för att hantera betalningar.`
    );
    this.name = "DemoModeError";
  }
}

/** Kasta ärligt fel om en demofunktion nås utanför demo-läge. */
export function assertDemoMode(feature: string): void {
  if (!isDemoMode()) throw new DemoModeError(feature);
}
