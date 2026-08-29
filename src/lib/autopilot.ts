import type { Verification } from "./types";

/**
 * Central beslutsmodul för den finansiella autopiloten.
 *
 * Governing principle: "Automatisera allt som är säkert och entydigt. Visa
 * bara exceptions och beslut som faktiskt kräver människan." Automatisering
 * får ALDRIG slå korrekthet – vid tvekan blir utfallet SUGGEST eller
 * REQUIRES_USER, aldrig en gissad bokning.
 *
 * ALLA konfidenströsklar bor här – aldrig utspridda magiska tal i tjänsterna.
 * Varje automatiskt beslut ska bära en kort förklaring i klartext
 * ("Matchad på exakt OCR + exakt belopp") som sparas på verifikationen.
 */

export type AutopilotOutcome = "AUTO_EXECUTE" | "SUGGEST" | "REQUIRES_USER" | "BLOCKED";

/** Konfidensgränser: ≥ AUTO ⇒ utför, ≥ SUGGEST ⇒ föreslå, annars människa. */
export const CONFIDENCE_THRESHOLDS = {
  /** Utfall är säkert och entydigt – systemet agerar självt. */
  AUTO: 0.98,
  /** Trolig tolkning – visas som förslag som användaren bekräftar. */
  SUGGEST: 0.8,
} as const;

/**
 * Öre-policy (ADR – se README "Öre och avrundning"):
 * Systemet räknar i hela kronor. Riktiga bankflöden bär ören; de avrundas till
 * hela kronor VID IMPORTGRÄNSEN. Avvikelser mellan inbetalt belopp och
 * fakturans att-betala som är ≤ denna gräns bokas automatiskt som
 * öresavrundning (BAS 3740). Större avvikelser blir aldrig "rättade" i det
 * tysta – de blir delbetalning/överbetalning med en exception till användaren.
 * 1 kr är den minsta möjliga avvikelsen i heltalsmodellen och motsvarar
 * öresavrundningens värsta fall vid importen (t.ex. 10 000,50 → 10 001).
 */
export const ORE_TOLERANS_KR = 1;

/** Mappa numerisk konfidens → utfall. Ett gemensamt ställe, aldrig ad hoc. */
export function decideFromConfidence(confidence: number): Exclude<AutopilotOutcome, "BLOCKED"> {
  if (confidence >= CONFIDENCE_THRESHOLDS.AUTO) return "AUTO_EXECUTE";
  if (confidence >= CONFIDENCE_THRESHOLDS.SUGGEST) return "SUGGEST";
  return "REQUIRES_USER";
}

/** Verifikationens tregradiga konfidens ur den numeriska. */
export function verificationConfidence(confidence: number): Verification["confidence"] {
  if (confidence >= CONFIDENCE_THRESHOLDS.AUTO) return "hog";
  if (confidence >= CONFIDENCE_THRESHOLDS.SUGGEST) return "medel";
  return "lag";
}

/**
 * Centrala exceptiontyper. Actionmotorn (services/actions.ts) är den enda
 * konsumenten – Hem/Bokföring/Ekonomi filtrerar samma lista, bygger aldrig
 * egna härledningar.
 */
export type FinancialExceptionType =
  | "MISSING_RECEIPT"
  | "UNCLEAR_EXPENSE"
  | "PAYMENT_MISMATCH"
  | "OVERDUE_INVOICE"
  | "VAT_ISSUE"
  | "BANK_RECONCILIATION_DIFFERENCE"
  | "ROT_READY"
  | "ROT_REJECTED"
  | "ROT_PAYOUT_PENDING"
  | "CREDIT_REFUND_DUE"
  | "INVOICE_DELIVERY_FAILED";
