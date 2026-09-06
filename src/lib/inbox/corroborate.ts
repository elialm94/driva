/**
 * Bekräftelse av en AI-tolkning med bevis utanför modellen.
 *
 * Vision-modellen läser vad som står på kvittot, men dess självskattning är
 * inte bevis – därför taket i ai/extract-document.ts, som håller en tolkad
 * läsning under autopilotens AUTO-tröskel. Det som får korsa tröskeln är
 * deterministiskt stöd som modellen inte kan påverka:
 *
 *   1. Momsräkningen stämmer mot en laglig svensk momssats. En felläst siffra
 *      bevarar nästan aldrig förhållandet moms/netto, så ett kvitto där momsen
 *      går jämnt upp mot 25, 12 eller 6 procent är läst som en helhet. Men
 *      totalen kan fortfarande vara delsumman i stället för slutsumman, så det
 *      här ensamt räcker till ett starkt förslag – inte till bokföring.
 *   2. Ett obokat kortköp i banken på exakt beloppet OCH med leverantörens
 *      namn som motpart. Då säger banken, inte modellen, både vad bolaget
 *      betalat och till vem. Med båda bevisen är läsningen säker nog att
 *      bokföras automatiskt.
 *
 * En bankträff som bara vilar på beloppet (rätt summa, entydig inom ±3 dagar)
 * bekräftar summan men inte vem som fick pengarna, och lyfter därför aldrig
 * ensam ett kvitto till automatisk bokföring – kategorin hänger på
 * leverantören.
 *
 * Modulen är ren: anroparen skickar in bevisen, så beslutsregeln går att läsa
 * och testa på ett ställe.
 */

import { CONFIDENCE_THRESHOLDS } from "../autopilot";
import type { InboundParsedHint, ParsedFieldKey } from "./inbound-mail";

/** Lagliga svenska momssatser. 0 % hanteras av att momsen är 0 kr. */
const VAT_RATES = [0.25, 0.12, 0.06] as const;

/** Konfidens efter enbart momsräkning: starkt förslag, aldrig automatik. */
const ARITHMETIC_CONFIDENCE = 0.95;
/** Konfidens när banken bekräftar både belopp och motpart. */
const BANK_CONFIRMED_CONFIDENCE = 0.99;

/**
 * Går momsen jämnt upp mot en laglig momssats? Tolerans 1 krona, samma
 * öre-policy som resten av produkten (autopilot.ts, ORE_TOLERANS_KR).
 */
export function vatArithmeticHolds(amount: number, vatAmount: number): boolean {
  if (!Number.isInteger(amount) || !Number.isInteger(vatAmount)) return false;
  if (amount < 1 || vatAmount < 0 || vatAmount >= amount) return false;
  if (vatAmount === 0) return false; // Momsfritt går inte att bekräfta med räkning.
  const net = amount - vatAmount;
  return VAT_RATES.some((rate) => Math.abs(vatAmount - Math.round(net * rate)) <= 1);
}

export interface HintEvidence {
  /**
   * Bankens stöd för läsningen, från matchReceiptToTransaction:
   * "hog" = exakt belopp och leverantörens namn som motpart (bekräftar både
   * summan och vem), "medel" = exakt belopp entydigt inom ±3 dagar (bekräftar
   * bara summan). Utan träff: undefined.
   */
  bankMatch?: "hog" | "medel";
}

export interface CorroboratedHint {
  hint: InboundParsedHint;
  /** Klarspråk om vad som bekräftade läsningen, för granskning och logg. */
  reasons: string[];
}

/**
 * Höj konfidensen på de fält bevisen bär. Sänker aldrig någonting och hittar
 * aldrig på ett värde – bara bekräftar det modellen läst.
 */
export function corroborateHint(hint: InboundParsedHint, evidence: HintEvidence = {}): CorroboratedHint {
  const reasons: string[] = [];
  const { amount, vatAmount } = hint;
  if (amount === undefined || vatAmount === undefined) return { hint, reasons };
  if (!vatArithmeticHolds(amount, vatAmount)) return { hint, reasons };

  // Bara en läsning modellen själv stod för räknas upp. En tolkning som
  // modellen kallade osäker blir inte säker av att räkningen råkar stämma.
  const fc = hint.fieldConfidence ?? {};
  const modelConfidence = (key: ParsedFieldKey) => fc[key] ?? hint.confidence ?? 0;
  if (Math.min(modelConfidence("amount"), modelConfidence("vatAmount")) < CONFIDENCE_THRESHOLDS.SUGGEST) {
    return { hint, reasons };
  }

  reasons.push("Momsen går jämnt upp mot en svensk momssats");
  const fieldConfidence: Partial<Record<ParsedFieldKey, number>> = { ...fc };
  const confirm = (key: ParsedFieldKey, value: number) => {
    fieldConfidence[key] = Math.max(fieldConfidence[key] ?? 0, value);
  };
  confirm("amount", ARITHMETIC_CONFIDENCE);
  confirm("vatAmount", ARITHMETIC_CONFIDENCE);

  if (evidence.bankMatch === "hog") {
    // Banken bekräftar summan och motparten – leverantören är därmed inte
    // längre bara modellens läsning.
    reasons.push("Banken har ett obokat kortköp på exakt beloppet hos samma leverantör");
    confirm("amount", BANK_CONFIRMED_CONFIDENCE);
    confirm("vatAmount", BANK_CONFIRMED_CONFIDENCE);
    confirm("supplier", BANK_CONFIRMED_CONFIDENCE);
  } else if (evidence.bankMatch === "medel") {
    reasons.push("Banken har ett obokat kortköp på exakt beloppet, men motparten stämmer inte av mot kvittot");
  }

  // Dokumentkonfidensen vilar på det svagaste fält en bokföring behöver:
  // leverantören ingår, eftersom kategorin hänger på vem köpet gjordes hos.
  const load: ParsedFieldKey[] = ["amount", "vatAmount", "supplier"];
  const confidence = Math.min(...load.map((key) => fieldConfidence[key] ?? modelConfidence(key)));
  return { hint: { ...hint, fieldConfidence, confidence }, reasons };
}
