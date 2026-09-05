import type { FiscalYear } from "../types";

/**
 * Arkiveringstiden, uttalad.
 *
 * Bokföringslagen 7 kap. 2 § säger att räkenskapsinformation ska bevaras till
 * och med det sjunde året efter utgången av det kalenderår då räkenskapsåret
 * avslutades. Det är inte "sju år från fakturadatum", vilket är den vanligaste
 * missuppfattningen: ett räkenskapsår som slutar i januari 2026 ska bevaras
 * lika länge som ett som slutar i december 2026, alltså till slutet av 2033.
 *
 * Driva säger tiden i klartext och tar aldrig bort något automatiskt när den
 * gått ut. Ett bolag med bokföring går inte heller att radera (se
 * platform/directory.ts) – gallring är i så fall ett medvetet beslut, inte en
 * bieffekt av att en timer löpte ut.
 */

export const RETENTION_YEARS = 7;

/** Sista dagen räkenskapsårets underlag måste finnas kvar. */
export function retentionUntil(fy: Pick<FiscalYear, "endDate">): string {
  const closedIn = Number(fy.endDate.slice(0, 4));
  return `${closedIn + RETENTION_YEARS}-12-31`;
}

/** Har arkiveringstiden gått ut vid det här datumet? */
export function retentionExpired(fy: Pick<FiscalYear, "endDate">, today: string): boolean {
  return today > retentionUntil(fy);
}

/** År kvar av arkiveringstiden, nedåt avrundat. 0 = tiden går ut i år. */
export function retentionYearsLeft(fy: Pick<FiscalYear, "endDate">, today: string): number {
  const until = Number(retentionUntil(fy).slice(0, 4));
  return Math.max(0, until - Number(today.slice(0, 4)));
}

/**
 * Policytexten som följer med i arkivet och visas i gränssnittet. En och samma
 * formulering på båda ställena, för att den som öppnar zip-filen 2033 ska läsa
 * exakt det som stod i appen när filen skapades.
 */
export function retentionPolicyText(fy: Pick<FiscalYear, "endDate" | "label">): string {
  const until = retentionUntil(fy);
  return [
    `Räkenskapsinformationen för ${fy.label} ska bevaras till och med ${until}.`,
    `Bokföringslagen 7 kap. 2 § räknar sju år från utgången av det kalenderår då räkenskapsåret avslutades (${fy.endDate.slice(0, 4)}), inte från varje fakturas datum.`,
    "Både verifikationerna och underlagen omfattas – en verifikation utan sitt underlag uppfyller inte kravet.",
  ].join(" ");
}
