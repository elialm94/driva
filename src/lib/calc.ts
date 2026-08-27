import type { DocLine, RotRut, VatRate } from "./types";

/** Skattereduktion: ROT 30 % av arbetskostnaden inkl. moms, RUT 50 %. Tak 50 000 kr/person och år. */
export const ROT_ANDEL = 0.3;
export const RUT_ANDEL = 0.5;
export const AVDRAG_TAK = 50_000;

export function taxReductionRate(type: RotRut["type"]): number {
  return type === "rot" ? ROT_ANDEL : RUT_ANDEL;
}

/**
 * V1-moms: svensk säljare → svensk kund, SEK, dessa satser.
 * Omvänd skattskyldighet, EU-försäljning, export, byggmoms och vinstmarginal stöds inte.
 */
export const SUPPORTED_VAT_RATES: readonly VatRate[] = [0, 6, 12, 25];

export function isSupportedVatRate(n: number): n is VatRate {
  return (SUPPORTED_VAT_RATES as readonly number[]).includes(n);
}

export interface DocTotals {
  /** Summa exkl. moms. */
  subtotal: number;
  /** Total moms. */
  vat: number;
  /** Summa inkl. moms. */
  total: number;
  /** Arbetskostnad inkl. moms (underlag för ROT/RUT). */
  laborInclVat: number;
  /** Skattereduktion (ROT/RUT). */
  deduction: number;
  /** Det kunden faktiskt betalar. */
  toPay: number;
}

export interface VatBreakdownRow {
  rate: number;
  base: number;
  vat: number;
}

export function lineTotal(line: DocLine): number {
  return Math.round(line.qty * line.unitPrice);
}

export function lineVat(line: DocLine): number {
  return Math.round(lineTotal(line) * (line.vatRate / 100));
}

export function docTotals(lines: DocLine[], rot: RotRut | null): DocTotals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const vat = lines.reduce((s, l) => s + lineVat(l), 0);
  const total = subtotal + vat;
  const laborInclVat = lines
    .filter((l) => l.kind === "arbete")
    .reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
  let deduction = 0;
  if (rot) {
    const andel = rot.type === "rot" ? ROT_ANDEL : RUT_ANDEL;
    deduction = Math.min(Math.round(laborInclVat * andel), AVDRAG_TAK);
  }
  return { subtotal, vat, total, laborInclVat, deduction, toPay: total - deduction };
}

/**
 * Moms per momssats – enda summeringen för offerter, fakturor, PDF och bokföring.
 * Inkluderar 0 % när sådana rader finns, så underlaget syns.
 * Radrabatt som eget fält finns inte i V1; negativt à-pris på en rad är den stödda rabattformen.
 */
export function vatBreakdown(lines: DocLine[]): VatBreakdownRow[] {
  const map = new Map<number, { base: number; vat: number }>();
  for (const l of lines) {
    const cur = map.get(l.vatRate) ?? { base: 0, vat: 0 };
    cur.base += lineTotal(l);
    cur.vat += lineVat(l);
    map.set(l.vatRate, cur);
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => ({ rate, ...v }));
}
