import type { DocLine, RotRut, VatRate } from "./types";
import { isTaxReductionEligible, lineTypeOf } from "./economic-line-type";

/**
 * Skattereduktion: ROT 30 % av arbetskostnaden inkl. moms, RUT 50 %.
 * Tak (2026): ROT 50 000 kr respektive RUT 75 000 kr per person och år.
 *
 * VIKTIGT ANTAGANDE: taken är dokumentbaserade vakter, inte Skatteverkets
 * saldo. Systemet KAN INTE veta kundens kvarvarande utrymme (andra utförares
 * fakturor, årets tidigare avdrag). Avdraget är därför alltid PRELIMINÄRT
 * tills Skatteverket betalat ut; nekade/delvis godkända beslut hanteras med
 * restfaktura (fordran flyttas 1513 → 1510, aldrig ny intäkt).
 */
export const ROT_ANDEL = 0.3;
export const RUT_ANDEL = 0.5;
export const ROT_TAK = 50_000;
export const RUT_TAK = 75_000;
/** @deprecated Använd taxReductionCap(type) – ROT och RUT har olika tak. */
export const AVDRAG_TAK = ROT_TAK;

export function taxReductionRate(type: RotRut["type"]): number {
  return type === "rot" ? ROT_ANDEL : RUT_ANDEL;
}

/** Lagstadgat tak per person och år för respektive avdragstyp. */
export function taxReductionCap(type: RotRut["type"]): number {
  return type === "rot" ? ROT_TAK : RUT_TAK;
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
  /** Skattereduktion som används (applied). Saknas applied → beräknat max. */
  deduction: number;
  /** Det kunden faktiskt betalar. */
  toPay: number;
  /** Maximalt avdrag utifrån denna offert/faktura. Inte Skatteverkets saldo. */
  calculatedEligibleTaxReduction: number;
}

export interface VatBreakdownRow {
  rate: number;
  base: number;
  vat: number;
}

export function lineTotal(line: DocLine): number {
  const qty = Number.isFinite(line.qty) ? line.qty : 0;
  const unitPrice = Number.isFinite(line.unitPrice) ? line.unitPrice : 0;
  return Math.round(qty * unitPrice);
}

export function lineVat(line: DocLine): number {
  return Math.round(lineTotal(line) * (line.vatRate / 100));
}

export function docTotals(lines: DocLine[], rot: RotRut | null): DocTotals {
  const subtotal = lines.reduce((s, l) => s + lineTotal(l), 0);
  const vat = lines.reduce((s, l) => s + lineVat(l), 0);
  const total = subtotal + vat;
  const laborInclVat = lines
    .filter((l) => isTaxReductionEligible(lineTypeOf(l), rot?.type ?? "rot"))
    .reduce((s, l) => s + lineTotal(l) + lineVat(l), 0);
  let calculatedEligibleTaxReduction = 0;
  if (rot) {
    const andel = taxReductionRate(rot.type);
    calculatedEligibleTaxReduction = Math.min(Math.round(laborInclVat * andel), taxReductionCap(rot.type));
  }
  let deduction = calculatedEligibleTaxReduction;
  if (rot && rot.appliedTaxReduction != null) {
    deduction = Math.max(0, Math.min(Math.round(rot.appliedTaxReduction), calculatedEligibleTaxReduction));
  }
  return {
    subtotal,
    vat,
    total,
    laborInclVat,
    deduction,
    toPay: total - deduction,
    calculatedEligibleTaxReduction,
  };
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
