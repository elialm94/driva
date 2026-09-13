/**
 * Kundens använda ROT/RUT i år enligt Fervas egna fakturor.
 *
 * taxReductionUsed på kunden (ifyllt "hos andra") räknas inte hit. Ett tomt
 * eller saknat värde är okänt - inte noll använt överallt. remainingTaxReduction
 * är därför bara Fervas fakturor mot lagens tak, inte Skatteverkets saldo.
 */
import type { Customer, Invoice, RotRut } from "./types";
import { ROT_RUT_GEMENSAMT_TAK, RUT_TAK, ROT_TAK, taxReductionCap } from "./calc";
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

/** Bara betalda Ferva-fakturor i samma år, minus ev. innevarande dokument. */
export function usedTaxReductionThisYear(input: {
  customer: Customer;
  invoices: Invoice[];
  year: number;
  excludeInvoiceId?: string;
}): TaxReductionUsed {
  // customer.taxReductionUsed läses medvetet inte. Tomt hos-andra är okänt,
  // inte 0, och ska inte adderas in i Fervas siffra.
  void input.customer.taxReductionUsed;
  let rot = 0;
  let rut = 0;
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

export function fervaCapAmount(type: RotRut["type"]): number {
  return type === "rot" ? ROT_TAK : RUT_TAK;
}
