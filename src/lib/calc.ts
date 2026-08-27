import type { DocLine, RotRut } from "./types";

/** Skattereduktion: ROT 30 % av arbetskostnaden inkl. moms, RUT 50 %. Tak 50 000 kr/person och år. */
const ROT_ANDEL = 0.3;
const RUT_ANDEL = 0.5;
const AVDRAG_TAK = 50_000;

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

/** Moms per momssats – för dokumentens summering. */
export function vatBreakdown(lines: DocLine[]): { rate: number; base: number; vat: number }[] {
  const map = new Map<number, { base: number; vat: number }>();
  for (const l of lines) {
    const cur = map.get(l.vatRate) ?? { base: 0, vat: 0 };
    cur.base += lineTotal(l);
    cur.vat += lineVat(l);
    map.set(l.vatRate, cur);
  }
  return [...map.entries()]
    .filter(([rate]) => rate > 0)
    .sort((a, b) => b[0] - a[0])
    .map(([rate, v]) => ({ rate, ...v }));
}
