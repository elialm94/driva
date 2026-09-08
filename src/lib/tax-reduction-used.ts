/**
 * Kundens använda ROT/RUT i år. Driva ser bara egna fakturor plus det
 * företagaren fyllt i från andra utförare. Resultatet är ett tak att
 * lova mot – inte Skatteverkets saldo.
 */
import type { Customer, Invoice, RotRut } from "./types";
import { ROT_RUT_GEMENSAMT_TAK, taxReductionCap } from "./calc";
import { invoiceTotals } from "./services/data";

export interface TaxReductionUsed {
  year: number;
  rot: number;
  rut: number;
}

export function taxYearOf(date: string): number {
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : new Date().getFullYear();
}

/** Manuellt ifyllt + betalda Driva-fakturor i samma år, minus ev. innevarande dokument. */
export function usedTaxReductionThisYear(input: {
  customer: Customer;
  invoices: Invoice[];
  year: number;
  excludeInvoiceId?: string;
}): TaxReductionUsed {
  const manual = input.customer.taxReductionUsed?.year === input.year ? input.customer.taxReductionUsed : undefined;
  let rot = manual?.rot ?? 0;
  let rut = manual?.rut ?? 0;
  for (const inv of input.invoices) {
    if (inv.customerId !== input.customer.id) continue;
    if (inv.id === input.excludeInvoiceId) continue;
    if (inv.type === "kredit" || inv.status === "krediterad" || inv.status === "utkast") continue;
    if (!inv.rot) continue;
    const paidYear = inv.paidAt ? taxYearOf(inv.paidAt) : taxYearOf(inv.issueDate);
    if (paidYear !== input.year) continue;
    const deduction = invoiceTotals(inv).deduction;
    if (inv.rot.type === "rot") rot += deduction;
    else rut += deduction;
  }
  return { year: input.year, rot, rut };
}

export function remainingTaxReduction(used: TaxReductionUsed, type: RotRut["type"]): number {
  const ownCap = taxReductionCap(type);
  const combinedLeft = Math.max(0, ROT_RUT_GEMENSAMT_TAK - used.rot - used.rut);
  const ownLeft = Math.max(0, ownCap - (type === "rot" ? used.rot : used.rut));
  return Math.min(ownLeft, combinedLeft);
}

export function clampDeductionToRemaining(
  calculated: number,
  remaining: number
): { applied: number; limited: boolean } {
  const applied = Math.max(0, Math.min(calculated, remaining));
  return { applied, limited: applied < calculated };
}
