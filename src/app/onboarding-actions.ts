"use server";

/**
 * Onboarding i två steg + Kom igång-centret.
 *
 *   steg 1  createCompanyAction     → företaget skapas (status company_done)
 *   steg 2  personalizeAction       → bransch/lön/bokföring sparas (complete) → Hem
 *   senare  setSetupTaskAction      → gör senare / behövs inte / återaktivera
 *           updateSetupProfileAction → ändra profilen under Inställningar → Kom igång
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createBusinessForCurrentUser, getSessionUser, listMemberships, withBusiness } from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/collaboration/permissions";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  firstOnboardingFieldId,
  readOnboardingFormData,
  validateOnboardingFields,
  type OnboardingField,
} from "@/lib/onboarding";
import { validatePersonalization } from "@/lib/setup/onboarding-state";
import { applyPersonalization, setSetupTaskOverride, updateSetupProfile } from "@/lib/services/onboarding";
import type { SetupTaskId, SetupTaskOverride } from "@/lib/types";
import { userFacingStorageError } from "@/lib/storage/sql-errors";

export interface CompanyStepState {
  error?: string;
  fieldErrors?: Partial<Record<OnboardingField, string>>;
  firstField?: string;
}

export async function createCompanyAction(_prev: CompanyStepState, formData: FormData): Promise<CompanyStepState> {
  if (!isSupabaseMode()) return { error: "Onboarding kräver Supabase-miljön." };
  const result = validateOnboardingFields(readOnboardingFormData(formData));
  if (Object.keys(result.fieldErrors).length > 0) {
    return {
      error: "Rätta uppgifterna – inget sparas förrän de stämmer.",
      fieldErrors: result.fieldErrors,
      firstField: firstOnboardingFieldId(result.fieldErrors),
    };
  }
  try {
    await createBusinessForCurrentUser({ ...result.values, onboardingStatus: "company_done" });
  } catch (e) {
    return { error: userFacingStorageError(e, "Företaget kunde inte skapas. Försök igen.") };
  }
  // Steg 2 avgörs av sparat tillstånd – sidan visar rätt steg även efter avbrott.
  redirect("/onboarding");
}

export interface PersonalizeStepState {
  error?: string;
  fieldErrors?: Partial<Record<"industries" | "otherIndustry" | "payroll" | "bookkeeping", string>>;
}

function readPersonalization(formData: FormData) {
  return {
    industries: formData.getAll("industries").map(String),
    otherIndustry: String(formData.get("otherIndustry") ?? ""),
    payroll: String(formData.get("payroll") ?? ""),
    bookkeeping: String(formData.get("bookkeeping") ?? ""),
  };
}

export async function personalizeAction(_prev: PersonalizeStepState, formData: FormData): Promise<PersonalizeStepState> {
  const raw = readPersonalization(formData);
  const validated = validatePersonalization(raw);
  if (!validated.values) {
    return { error: "Välj ett alternativ på varje fråga.", fieldErrors: validated.errors };
  }
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const memberships = await listMemberships(user.id);
  const owned = memberships.find((m) => isOwnerRole(m.role));
  if (!owned && isSupabaseMode()) redirect("/onboarding");
  try {
    await withBusiness(
      () => {
        applyPersonalization(validated.values!);
      },
      owned ? { businessId: owned.businessId } : {},
    );
  } catch (e) {
    return { error: userFacingStorageError(e, "Svaren kunde inte sparas. Försök igen.") };
  }
  redirect("/");
}

type Result = { ok: true } | { ok: false; error: string };

export async function setSetupTaskAction(taskId: SetupTaskId, state: SetupTaskOverride["state"] | null): Promise<Result> {
  try {
    await withBusiness(() => {
      setSetupTaskOverride(taskId, state);
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userFacingStorageError(e, "Ändringen kunde inte sparas.") };
  }
}

export async function updateSetupProfileAction(input: {
  industries: string[];
  otherIndustry?: string;
  payroll: string;
  bookkeeping: string;
}): Promise<Result> {
  try {
    await withBusiness(() => {
      updateSetupProfile(input);
    });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: userFacingStorageError(e, "Profilen kunde inte sparas.") };
  }
}
