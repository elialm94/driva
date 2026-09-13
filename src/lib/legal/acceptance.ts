/**
 * Villkorsgodkännande (spec §7): vilken version användaren aktivt godkänt,
 * grinden som kräver nytt godkännande vid väsentlig ändring och registreringen
 * av godkännandet (append-only, per användare med företag i sessionen).
 *
 * Bevis vid registrering: signup-formuläret kräver kryssrutan och versionen
 * skrivs i user_metadata (terms_version). Första inloggade sidladdningen
 * flyttar beviset till terms_acceptances (source "signup") så att historiken
 * finns i en tabell och inte bara i auth-metadata.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { uid } from "../ids";
import { getSessionUser, isDemoSession, sessionTermsHint } from "../auth/session";
import { isSupabaseMode } from "../storage/config";
import { tenantContext } from "../storage/context";
import { requestSlot } from "../storage/request-scope";
import { insertTermsAcceptance, latestTermsAcceptance, listTermsAcceptances } from "../platform/store";
import type { TermsAcceptanceRecord, TermsAcceptanceSource } from "../platform/types";
import { LEGAL_DOCUMENTS, TERMS_VERSION, needsReacceptance } from "./documents";

export const TERMS_GATE_PATH = "/godkann-villkor";

export interface TermsGateDecision {
  /** Måste användaren godkänna nu? */
  required: boolean;
  /** Version användaren senast godkände (tabell eller registreringsbevis). */
  acceptedVersion: string | null;
  /** Registreringsbeviset ska skrivas till tabellen. */
  persistFromSignup: boolean;
}

/** Ren beslutslogik – testbar utan databas. */
export function termsGateDecision(input: {
  recorded: string | null;
  signupHint: string | null;
  current?: string;
}): TermsGateDecision {
  const current = input.current ?? TERMS_VERSION;
  if (input.recorded && !needsReacceptance(input.recorded, current)) {
    return { required: false, acceptedVersion: input.recorded, persistFromSignup: false };
  }
  if (input.signupHint && !needsReacceptance(input.signupHint, current)) {
    return { required: false, acceptedVersion: input.signupHint, persistFromSignup: !input.recorded };
  }
  return { required: true, acceptedVersion: input.recorded ?? input.signupHint, persistFromSignup: false };
}

async function currentBusinessId(): Promise<string | undefined> {
  return requestSlot().businessId ?? tenantContext()?.businessId ?? undefined;
}

export async function recordTermsAcceptance(input: {
  userId: string;
  email?: string;
  businessId?: string;
  source: TermsAcceptanceSource;
  version?: string;
  acceptedAt?: string;
}): Promise<TermsAcceptanceRecord> {
  const rec: TermsAcceptanceRecord = {
    id: uid(),
    userId: input.userId,
    businessId: input.businessId,
    document: "villkor",
    version: input.version ?? TERMS_VERSION,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
    source: input.source,
    email: input.email,
  };
  await insertTermsAcceptance(rec);
  return rec;
}

/**
 * Grindstatus för requesten. Demo och JSON-läge har inget avtal att godkänna
 * (ingen registrering) och släpps alltid igenom.
 */
export const termsGateStatus = cache(async (): Promise<TermsGateDecision> => {
  const pass: TermsGateDecision = { required: false, acceptedVersion: null, persistFromSignup: false };
  if (!isSupabaseMode()) return pass;
  if (await isDemoSession()) return pass;
  const user = await getSessionUser();
  if (!user) return pass;
  const [recorded, hint] = await Promise.all([latestTermsAcceptance(user.id), sessionTermsHint()]);
  const decision = termsGateDecision({ recorded: recorded?.version ?? null, signupHint: hint?.version ?? null });
  if (decision.persistFromSignup && hint) {
    await recordTermsAcceptance({
      userId: user.id,
      email: user.email,
      businessId: await currentBusinessId(),
      source: "signup",
      version: hint.version,
      acceptedAt: hint.acceptedAt,
    }).catch(() => undefined);
  }
  return decision;
});

/** Kräver aktuell villkorsversion – annars redirect till godkännandesidan. */
export async function ensureTermsAccepted(nextPath: string): Promise<void> {
  const decision = await termsGateStatus();
  if (!decision.required) return;
  const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
  redirect(`${TERMS_GATE_PATH}?next=${encodeURIComponent(safeNext)}`);
}

/** Underlag för godkännandesidan: vad som ändrats och vilken version som gäller. */
export function termsGateContent() {
  const meta = LEGAL_DOCUMENTS.villkor;
  return {
    version: meta.version,
    effectiveFrom: meta.effectiveFrom,
    changeSummary: meta.changeSummary,
    termsPath: meta.path,
    privacyPath: LEGAL_DOCUMENTS.integritet.path,
    dpaPath: LEGAL_DOCUMENTS.dpa.path,
  };
}

export { listTermsAcceptances, latestTermsAcceptance };
