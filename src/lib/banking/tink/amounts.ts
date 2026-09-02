/**
 * Beloppsgränsen mot Tink (ADR-1: hela kronor i systemet).
 *
 * Tink levererar belopp som { unscaledValue, scale } där värdet är
 * unscaledValue · 10^-scale (t.ex. unscaledValue "-1300", scale "1" = -130,0).
 * Konverteringen till hela kronor sker HÄR, vid importgränsen – aldrig i
 * matchningsmotorn. Öresdiffar (≤ 1 kr) tolereras och bokas på 3740 av
 * matchningen precis som förut.
 */

export interface TinkScaledValue {
  unscaledValue: string | number;
  scale: string | number;
}

/** Tink-belopp → hela kronor (avrundat, halva ören uppåt i absolutbelopp). */
export function tinkAmountToKronor(value: TinkScaledValue): number {
  const unscaled = Number(value.unscaledValue);
  const scale = Number(value.scale);
  if (!Number.isFinite(unscaled) || !Number.isFinite(scale)) {
    throw new Error("Ogiltigt belopp från banken.");
  }
  const amount = unscaled / 10 ** scale;
  return roundHalfAwayFromZero(amount);
}

/** Öre (heltal) → hela kronor. */
export function oreToKronor(ore: number): number {
  if (!Number.isFinite(ore)) throw new Error("Ogiltigt belopp från banken.");
  return roundHalfAwayFromZero(ore / 100);
}

/** Math.round avrundar -0,5 → -0; vi vill ha symmetrisk avrundning (−130,50 → −131). */
function roundHalfAwayFromZero(n: number): number {
  const rounded = Math.sign(n) * Math.round(Math.abs(n));
  // Undvik -0 i JSON/DB.
  return rounded === 0 ? 0 : rounded;
}
