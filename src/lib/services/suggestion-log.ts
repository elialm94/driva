import { createHash, randomUUID } from "node:crypto";
import { tenantContext } from "../storage/context";
import { insertSuggestionEvent } from "../platform/store";
import type { SuggestionDecision, SuggestionEvent } from "../platform/types";
import { MERCHANT_KB_VERSION, normalizeMerchant } from "../banking/merchants";
import type { BankSuggestion } from "./bank-suggestion";

/**
 * Loggar förslagsbeslut för kvalitetsuppföljningen i admin – aggregerbart,
 * utan känsligt innehåll. Det som sparas är signalkälla, nivå, beslut,
 * riskflaggor, kunskapsbas-/regelversion, ev. LLM-uppgifter (leverantör,
 * modell, promptversion) och en hash av indata. Aldrig motpartstext, belopp
 * (bara spann), dokumentinnehåll eller personnummer.
 *
 * Loggningen får aldrig stoppa en bokföring: fel sväljs och rapporteras bara
 * i serverloggen.
 */

export interface SuggestionInput {
  amount: number;
  counterpart: string;
  date: string;
}

export function suggestionInputHash(input: SuggestionInput): string {
  const key = normalizeMerchant(input.counterpart).key;
  return createHash("sha256").update(`${key}|${Math.round(input.amount)}|${input.date.slice(0, 10)}`).digest("hex").slice(0, 32);
}

export function amountBucket(amount: number): SuggestionEvent["amountBucket"] {
  const abs = Math.abs(amount);
  return abs < 500 ? "under_500" : abs <= 5_000 ? "500_5000" : "over_5000";
}

export interface RecordSuggestionDecisionInput {
  input: SuggestionInput;
  direction: "in" | "ut";
  source: string;
  tier: SuggestionEvent["tier"];
  decision: SuggestionDecision;
  humanRequired: readonly string[];
  merchantType?: string;
  ruleVersion?: number;
  suggested?: string;
  finalChoice: string;
  llm?: { provider: string; model: string; promptVersion: string } | null;
}

export function buildSuggestionEvent(input: RecordSuggestionDecisionInput, now = new Date()): SuggestionEvent {
  const businessId = tenantContext()?.businessId;
  return {
    id: randomUUID(),
    ...(businessId ? { businessId } : {}),
    createdAt: now.toISOString(),
    direction: input.direction,
    source: input.source,
    tier: input.tier,
    decision: input.decision,
    humanRequired: [...input.humanRequired],
    ...(input.merchantType ? { merchantType: input.merchantType } : {}),
    kbVersion: MERCHANT_KB_VERSION,
    ...(input.ruleVersion ? { ruleVersion: input.ruleVersion } : {}),
    provider: input.llm?.provider ?? null,
    model: input.llm?.model ?? null,
    promptVersion: input.llm?.promptVersion ?? null,
    inputHash: suggestionInputHash(input.input),
    ...(input.suggested ? { suggested: input.suggested } : {}),
    finalChoice: input.finalChoice,
    amountBucket: amountBucket(input.input.amount),
  };
}

export async function recordSuggestionDecision(input: RecordSuggestionDecisionInput): Promise<void> {
  try {
    await insertSuggestionEvent(buildSuggestionEvent(input));
  } catch (e) {
    console.warn("[suggestion-log] kunde inte logga förslagsbeslut:", e instanceof Error ? e.message : e);
  }
}

/** Hjälpare: beslut på en bankbedömning (bokfört som typ, privat, ändrat …). */
export function decisionFromAssessment(
  s: BankSuggestion,
  tx: SuggestionInput,
  finalChoice: string,
  decision: SuggestionDecision
): RecordSuggestionDecisionInput {
  const suggested =
    s.payment.kind === "bank_kind" ? s.payment.bankKind : s.payment.kind === "none" ? undefined : s.payment.kind;
  return {
    input: tx,
    direction: s.direction,
    source: s.source,
    tier: s.tier,
    decision,
    humanRequired: s.humanRequired,
    merchantType: s.merchant.knowledge?.type,
    ruleVersion: s.ruleVersion,
    suggested,
    finalChoice,
    llm: null,
  };
}

/** Vilket beslut ett mänskligt val motsvarar givet vad som föreslogs. */
export function classifyDecision(suggested: string | undefined, finalChoice: string): SuggestionDecision {
  if (finalChoice === "privat_kop" || finalChoice === "privat") return "private";
  if (!suggested) return "accepted";
  return suggested === finalChoice ? "accepted" : "changed";
}
