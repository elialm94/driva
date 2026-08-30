import { docTotals } from "./calc";
import type { DocLine, RotRut } from "./types";
import {
  taxReductionAmountHelp,
  taxReductionAppliedLabel,
  taxReductionCalcHintText,
  taxReductionClampedMessage,
  taxReductionDocumentMaxLabel,
  taxReductionExceedsMaxError,
  taxReductionMaxLabel,
  TAX_REDUCTION_USE_MAX_LABEL,
} from "./tax-reduction-terms";

export type TaxReductionDocumentKind = "faktura" | "offert";

export interface ResolvedTaxReductionAmounts {
  calculatedEligibleTaxReduction: number;
  appliedTaxReduction: number;
  taxReductionManuallyAdjusted: boolean;
  /** true när applied sänktes för att max blev lägre än tidigare applied. */
  clamped: boolean;
}

function roundKr(n: number): number {
  return Math.round(n);
}

export function calculatedEligibleTaxReduction(lines: DocLine[], type: RotRut["type"] | null | undefined): number {
  if (!type) return 0;
  return docTotals(lines, { type }).calculatedEligibleTaxReduction;
}

/**
 * Avgör applied vs calculated. Driva vet inte kundens saldo hos Skatteverket –
 * calculated är bara max utifrån dokumentets arbetskostnad och ROT/RUT-regler.
 */
export function resolveTaxReductionAmounts(input: {
  lines: DocLine[];
  type: RotRut["type"];
  appliedTaxReduction?: number | null;
  taxReductionManuallyAdjusted?: boolean;
}): ResolvedTaxReductionAmounts {
  const calculated = calculatedEligibleTaxReduction(input.lines, input.type);
  const manually = Boolean(input.taxReductionManuallyAdjusted);
  if (!manually || input.appliedTaxReduction == null || !Number.isFinite(input.appliedTaxReduction)) {
    return {
      calculatedEligibleTaxReduction: calculated,
      appliedTaxReduction: calculated,
      taxReductionManuallyAdjusted: false,
      clamped: false,
    };
  }
  const requested = roundKr(input.appliedTaxReduction);
  // Ingen arbetskostnad ännu: klampar inte ärvt avdrag till 0 (t.ex. ny faktura från offert).
  if (calculated === 0) {
    return {
      calculatedEligibleTaxReduction: 0,
      appliedTaxReduction: Math.max(0, requested),
      taxReductionManuallyAdjusted: true,
      clamped: false,
    };
  }
  if (requested > calculated) {
    return {
      calculatedEligibleTaxReduction: calculated,
      appliedTaxReduction: calculated,
      taxReductionManuallyAdjusted: true,
      clamped: true,
    };
  }
  const applied = Math.max(0, requested);
  return {
    calculatedEligibleTaxReduction: calculated,
    appliedTaxReduction: applied,
    taxReductionManuallyAdjusted: true,
    clamped: applied !== requested,
  };
}

export function rotFromAmounts(type: RotRut["type"], amounts: ResolvedTaxReductionAmounts): RotRut {
  return {
    type,
    calculatedEligibleTaxReduction: amounts.calculatedEligibleTaxReduction,
    appliedTaxReduction: amounts.appliedTaxReduction,
    taxReductionManuallyAdjusted: amounts.taxReductionManuallyAdjusted,
  };
}

export function syncRotWithLines(rot: RotRut, lines: DocLine[]): {
  rot: RotRut;
  clamped: boolean;
  appliedTaxReduction: number;
} {
  const resolved = resolveTaxReductionAmounts({
    lines,
    type: rot.type,
    appliedTaxReduction: rot.appliedTaxReduction,
    taxReductionManuallyAdjusted: rot.taxReductionManuallyAdjusted,
  });
  return {
    rot: rotFromAmounts(rot.type, resolved),
    clamped: resolved.clamped,
    appliedTaxReduction: resolved.appliedTaxReduction,
  };
}

export function assertAppliedWithinMax(
  applied: number,
  calculated: number,
  documentKind: TaxReductionDocumentKind
): void {
  if (!Number.isFinite(applied) || applied < 0) {
    throw new Error("Avdraget kan inte vara negativt.");
  }
  if (applied > calculated) {
    throw new Error(taxReductionExceedsMaxError(calculated, documentKind));
  }
}

/**
 * Spara applied/calculated på rot.
 * - strict: kasta om applied > max (användar-/AI-inmatning)
 * - clamp: sänk till nytt max (ärvd från offert, radändring)
 */
export function rotWithAmounts(
  rot: RotRut | null,
  lines: DocLine[],
  opts?: {
    inheritFrom?: RotRut | null;
    mode?: "strict" | "clamp";
    documentKind?: TaxReductionDocumentKind;
  }
): RotRut | null {
  if (!rot) return null;
  const calculated = calculatedEligibleTaxReduction(lines, rot.type);
  const mode = opts?.mode ?? "strict";
  const kind = opts?.documentKind ?? "faktura";
  const source: RotRut = rot.appliedTaxReduction != null ? rot : (opts?.inheritFrom ?? rot);
  const explicit = rot.appliedTaxReduction != null;

  if (source.appliedTaxReduction == null) {
    return rotFromAmounts(rot.type, {
      calculatedEligibleTaxReduction: calculated,
      appliedTaxReduction: calculated,
      taxReductionManuallyAdjusted: false,
      clamped: false,
    });
  }

  const requested = roundKr(source.appliedTaxReduction);

  if (requested < 0 || requested > calculated) {
    if (mode === "strict" && explicit) {
      assertAppliedWithinMax(requested, calculated, kind);
    }
  }

  const applied = Math.max(0, Math.min(requested, calculated));
  return {
    type: rot.type,
    calculatedEligibleTaxReduction: calculated,
    appliedTaxReduction: applied,
    taxReductionManuallyAdjusted: applied !== calculated || Boolean(source.taxReductionManuallyAdjusted),
  };
}

/** Alla UI-/feltexter som rör avdragsbelopp – för copy-audit. */
export function taxReductionAmountCopyCorpus(kind: TaxReductionDocumentKind = "faktura"): string {
  return [
    taxReductionExceedsMaxError(40_000, kind),
    taxReductionClampedMessage("rot", 25_000, kind),
    taxReductionClampedMessage("rut", 25_000, kind),
    taxReductionAmountHelp(kind),
    taxReductionMaxLabel("rot"),
    taxReductionMaxLabel("rut"),
    taxReductionAppliedLabel("rot"),
    taxReductionAppliedLabel("rut"),
    TAX_REDUCTION_USE_MAX_LABEL,
    taxReductionDocumentMaxLabel(kind, 40_000),
    "Preliminärt ROT-avdrag",
    "Preliminärt RUT-avdrag",
    taxReductionCalcHintText("rot", 15_600),
    taxReductionCalcHintText("rut", 15_600),
  ].join("\n");
}
