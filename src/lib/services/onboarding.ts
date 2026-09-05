/**
 * Onboardingens tillstånd i tenantaggregatet (db().onboarding) och
 * Kom igång-profilen (bransch, lön, bokföringssituation, uppgiftsval).
 * Alla skrivningar går genom withBusiness som allt annat.
 */
import { db, save } from "../store";
import type { OnboardingState, SetupTaskId, SetupTaskOverride } from "../types";
import {
  onboardingAfterCompany,
  onboardingAfterPersonalization,
  onboardingIsComplete,
  type PersonalizationAnswers,
  validatePersonalization,
} from "../setup/onboarding-state";
import { logActivity } from "./activity";

export function getOnboardingState(): OnboardingState | null {
  return db().onboarding ?? null;
}

export function onboardingComplete(): boolean {
  return onboardingIsComplete(getOnboardingState());
}

/** Steg 1 är klart (företaget finns) – används när raden saknas i JSON-läget. */
export function markCompanyStepDone(now = new Date().toISOString()): OnboardingState {
  const data = db();
  data.onboarding = onboardingAfterCompany(data.onboarding, now);
  save();
  return data.onboarding;
}

/** Steg 2 – "Öppna Ferva". Idempotent: körs den igen uppdateras bara svaren. */
export function savePersonalization(raw: {
  industries: unknown;
  otherIndustry?: unknown;
  payroll: unknown;
  bookkeeping: unknown;
}): OnboardingState {
  const validated = validatePersonalization(raw);
  if (!validated.values) {
    const first = Object.values(validated.errors)[0] ?? "Kontrollera svaren.";
    throw new Error(first);
  }
  return applyPersonalization(validated.values);
}

export function applyPersonalization(answers: PersonalizationAnswers, now = new Date().toISOString()): OnboardingState {
  const data = db();
  const wasComplete = onboardingIsComplete(data.onboarding);
  data.onboarding = onboardingAfterPersonalization(data.onboarding, answers, now);
  if (!wasComplete) logActivity("Kom igång: företaget är anpassat och Ferva är öppet.");
  save();
  return data.onboarding;
}

/**
 * "Gör senare" / "Behövs inte" för en Kom igång-uppgift, eller återaktivera
 * (state = null). Bara sådant som inte kan härledas ur data sparas.
 */
export function setSetupTaskOverride(taskId: SetupTaskId, state: SetupTaskOverride["state"] | null): OnboardingState {
  const data = db();
  const now = new Date().toISOString();
  const current = data.onboarding ?? onboardingAfterPersonalizationForLegacy(now);
  const overrides = { ...(current.taskOverrides ?? {}) };
  if (state) overrides[taskId] = { state, at: now };
  else delete overrides[taskId];
  data.onboarding = { ...current, taskOverrides: overrides, updatedAt: now };
  save();
  return data.onboarding;
}

/**
 * Företag utan onboarding-rad (före flödet, JSON-demo) som ändå använder
 * Kom igång-centret får en klar rad så att uppgiftsval kan sparas.
 */
function onboardingAfterPersonalizationForLegacy(now: string): OnboardingState {
  return {
    status: "complete",
    currentStep: null,
    startedAt: now,
    companyCompletedAt: now,
    personalizationCompletedAt: now,
    completedAt: now,
    industries: [],
    payroll: null,
    bookkeeping: null,
    taskOverrides: {},
    updatedAt: now,
  };
}

/** Inställningar → Kom igång: ändra profilen i efterhand. Låser inget. */
export function updateSetupProfile(raw: {
  industries: unknown;
  otherIndustry?: unknown;
  payroll: unknown;
  bookkeeping: unknown;
}): OnboardingState {
  const validated = validatePersonalization(raw);
  if (!validated.values) {
    const first = Object.values(validated.errors)[0] ?? "Kontrollera svaren.";
    throw new Error(first);
  }
  const data = db();
  const now = new Date().toISOString();
  const current = data.onboarding ?? onboardingAfterPersonalizationForLegacy(now);
  const v = validated.values;
  const { otherIndustry: _previousOther, ...rest } = current;
  void _previousOther;
  data.onboarding = {
    ...rest,
    industries: v.industries,
    ...(v.industries.includes("annat") && v.otherIndustry ? { otherIndustry: v.otherIndustry } : {}),
    payroll: v.payroll,
    bookkeeping: v.bookkeeping,
    updatedAt: now,
  };
  logActivity("Kom igång-profilen uppdaterades.");
  save();
  return data.onboarding;
}
