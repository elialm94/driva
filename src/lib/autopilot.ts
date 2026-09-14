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

/**
 * Utgiftskategorier som ALDRIG bokförs automatiskt, oavsett konfidens.
 *
 * Representation hör hit av samma skäl som överbetalningar och delvisa
 * ROT/RUT-utbetalningar: utfallet beror på uppgifter som bara människan har.
 * Antal personer och om alkohol ingick står varken i banktransaktionen eller
 * på kvittoraden, och de avgör både avdraget (6071/7631 mot 6072/7632) och
 * hur mycket moms som får lyftas. En inlärd leverantörsregel gör kategorin
 * säker men inte uppgifterna - därför är representation REQUIRES_USER tills
 * frågan är besvarad.
 */
export const NEVER_AUTO_EXPENSE_CATEGORIES: readonly string[] = ["representation"];

/**
 * Utfallet för en kategoriserad utgift. Kategorins regel går före konfidensen:
 * en kategori i listan ovan blir alltid REQUIRES_USER.
 */
export function expenseCategoryOutcome(
  categoryKey: string,
  confidence: Verification["confidence"]
): Exclude<AutopilotOutcome, "BLOCKED"> {
  if (NEVER_AUTO_EXPENSE_CATEGORIES.includes(categoryKey)) return "REQUIRES_USER";
  if (confidence === "hog") return "AUTO_EXECUTE";
  if (confidence === "medel") return "SUGGEST";
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
