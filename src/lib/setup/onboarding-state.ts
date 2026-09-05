/**
 * Onboardingens tillstånd och Kom igång-profilen – rena funktioner utan
 * store/fs så att både klientformulär, server actions och tester kan dela dem.
 *
 * Två steg: 1) Ditt företag (skapar företaget → company_done),
 * 2) Anpassa Ferva (bransch, lön, bokföring → complete). En avbruten
 * användare fortsätter på det steg som återstår; företag som fanns före
 * flödet (ingen rad / status complete) berörs aldrig.
 */
import type {
  OnboardingBookkeeping,
  OnboardingIndustry,
  OnboardingPayroll,
  OnboardingState,
  OnboardingStatus,
  OnboardingStep,
} from "../types";

export const INDUSTRY_OPTIONS: { value: OnboardingIndustry; label: string }[] = [
  { value: "el", label: "El" },
  { value: "vvs", label: "VVS" },
  { value: "bygg", label: "Bygg och snickeri" },
  { value: "maleri", label: "Måleri" },
  { value: "mark", label: "Mark och anläggning" },
  { value: "annat", label: "Annat" },
];

export const PAYROLL_OPTIONS: { value: OnboardingPayroll; label: string }[] = [
  { value: "none", label: "Nej, inte idag" },
  { value: "owner", label: "Ja, till mig som ägare" },
  { value: "employees", label: "Ja, till anställda" },
  { value: "later", label: "Jag tar det senare" },
];

export const BOOKKEEPING_OPTIONS: { value: OnboardingBookkeeping; label: string }[] = [
  { value: "existing", label: "Företaget har bokföring som ska flyttas hit" },
  { value: "new", label: "Företaget är nystartat" },
  { value: "consultant", label: "Min redovisningskonsult sköter bokföringen" },
  { value: "later", label: "Jag tar det senare" },
];

export const COMPANY_FORM_OPTIONS: { value: "ab" | "enskild" | "annan"; label: string }[] = [
  { value: "ab", label: "Aktiebolag" },
  { value: "enskild", label: "Enskild firma" },
  { value: "annan", label: "Annan företagsform" },
];

/** Ärligt besked när företagsformen inte stöds – vi gissar inte redovisningsregler. */
export const UNSUPPORTED_COMPANY_FORM_MESSAGE =
  "Ferva stödjer just nu aktiebolag och enskild firma. Handelsbolag, föreningar och andra företagsformer kan inte skapas ännu – bokföring och skatt skulle bli fel om vi gissade.";

export function industryLabel(value: OnboardingIndustry): string {
  return INDUSTRY_OPTIONS.find((o) => o.value === value)?.label ?? value;
}

export function isOnboardingIndustry(value: unknown): value is OnboardingIndustry {
  return typeof value === "string" && INDUSTRY_OPTIONS.some((o) => o.value === value);
}
export function isOnboardingPayroll(value: unknown): value is OnboardingPayroll {
  return typeof value === "string" && PAYROLL_OPTIONS.some((o) => o.value === value);
}
export function isOnboardingBookkeeping(value: unknown): value is OnboardingBookkeeping {
  return typeof value === "string" && BOOKKEEPING_OPTIONS.some((o) => o.value === value);
}

export function newOnboardingState(now = new Date().toISOString()): OnboardingState {
  return {
    status: "not_started",
    currentStep: "company",
    startedAt: now,
    industries: [],
    payroll: null,
    bookkeeping: null,
    taskOverrides: {},
    updatedAt: now,
  };
}

/** Efter steg 1: företaget finns, personaliseringen återstår. */
export function onboardingAfterCompany(
  state: OnboardingState | null | undefined,
  now = new Date().toISOString(),
): OnboardingState {
  const base = state ?? newOnboardingState(now);
  return {
    ...base,
    status: base.status === "complete" ? "complete" : "company_done",
    currentStep: base.status === "complete" ? null : "personalize",
    companyCompletedAt: base.companyCompletedAt ?? now,
    updatedAt: now,
  };
}

export interface PersonalizationAnswers {
  industries: OnboardingIndustry[];
  otherIndustry?: string;
  payroll: OnboardingPayroll;
  bookkeeping: OnboardingBookkeeping;
}

/** Efter steg 2 ("Öppna Ferva"): allt klart. */
export function onboardingAfterPersonalization(
  state: OnboardingState | null | undefined,
  answers: PersonalizationAnswers,
  now = new Date().toISOString(),
): OnboardingState {
  const base = state ?? onboardingAfterCompany(null, now);
  return {
    ...base,
    status: "complete",
    currentStep: null,
    companyCompletedAt: base.companyCompletedAt ?? now,
    personalizationCompletedAt: now,
    completedAt: now,
    industries: answers.industries,
    ...(answers.industries.includes("annat") && answers.otherIndustry?.trim()
      ? { otherIndustry: answers.otherIndustry.trim().slice(0, 80) }
      : { otherIndustry: undefined }),
    payroll: answers.payroll,
    bookkeeping: answers.bookkeeping,
    updatedAt: now,
  };
}

/** Ett företag som fanns före flödet (ingen rad) räknas alltid som klart. */
export function onboardingStatusOf(state: OnboardingState | null | undefined): OnboardingStatus {
  return state?.status ?? "complete";
}

export function onboardingIsComplete(state: OnboardingState | null | undefined): boolean {
  return onboardingStatusOf(state) === "complete";
}

/**
 * Vilket steg /onboarding ska visa. Utan företag: steg 1. Med företag men
 * ofullständig onboarding: steg 2. Klar: ingen onboarding alls.
 */
export function resumeStepFor(input: { hasBusiness: boolean; status: OnboardingStatus | undefined }): OnboardingStep | "done" {
  if (!input.hasBusiness) return "company";
  const status = input.status ?? "complete";
  if (status === "complete") return "done";
  return "personalize";
}

/**
 * Ska en inloggad ägare skickas till /onboarding? Bara när det egna
 * företagets onboarding inte är klar. Konsultmedlemskap räknas inte.
 */
export function ownerNeedsOnboarding<R>(
  memberships: { role: R; onboardingStatus?: OnboardingStatus }[],
  isOwnerRole: (role: R) => boolean,
): boolean {
  const owned = memberships.filter((m) => isOwnerRole(m.role));
  if (owned.length === 0) return false;
  return owned.every((m) => (m.onboardingStatus ?? "complete") !== "complete");
}

export interface PersonalizationValidation {
  errors: Partial<Record<"industries" | "otherIndustry" | "payroll" | "bookkeeping", string>>;
  values?: PersonalizationAnswers;
}

/** Servern validerar alltid – klienten är bara hjälp. */
export function validatePersonalization(raw: {
  industries: unknown;
  otherIndustry?: unknown;
  payroll: unknown;
  bookkeeping: unknown;
}): PersonalizationValidation {
  const errors: PersonalizationValidation["errors"] = {};
  const list = Array.isArray(raw.industries) ? raw.industries : [];
  const industries = [...new Set(list.filter(isOnboardingIndustry))];
  if (industries.length === 0) errors.industries = "Välj minst ett område – du kan ändra det senare.";
  const otherIndustry = typeof raw.otherIndustry === "string" ? raw.otherIndustry.trim() : "";
  if (industries.includes("annat") && !otherIndustry) errors.otherIndustry = "Skriv kort vad företaget arbetar med.";
  if (!isOnboardingPayroll(raw.payroll)) errors.payroll = "Välj ett alternativ.";
  if (!isOnboardingBookkeeping(raw.bookkeeping)) errors.bookkeeping = "Välj ett alternativ.";
  if (Object.keys(errors).length > 0) return { errors };
  return {
    errors,
    values: {
      industries,
      ...(otherIndustry ? { otherIndustry: otherIndustry.slice(0, 80) } : {}),
      payroll: raw.payroll as OnboardingPayroll,
      bookkeeping: raw.bookkeeping as OnboardingBookkeeping,
    },
  };
}

/** Kort beskrivning av verksamheten – används i Kom igång och Inställningar. */
export function industriesSummary(state: OnboardingState | null | undefined): string {
  if (!state || state.industries.length === 0) return "";
  return state.industries
    .map((i) => (i === "annat" && state.otherIndustry ? state.otherIndustry : industryLabel(i)))
    .join(", ");
}
