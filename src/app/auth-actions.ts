"use server";

/**
 * Autentisering: e-post + lösenord via Supabase Auth.
 * Medvetet minimalt: ingen social inloggning, ingen MFA, ingen SSO.
 */
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createBusinessForCurrentUser } from "@/lib/auth/session";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  readOnboardingFormData,
  validateOnboardingFields,
  type OnboardingField,
} from "@/lib/onboarding";

export interface AuthFormState {
  error?: string;
  notice?: string;
}

/** Endast interna sökvägar – aldrig öppna redirects. */
function safeNext(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  if (value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/login")) return value;
  return "/";
}

function authUnavailable(): AuthFormState {
  return {
    error:
      "Inloggning kräver Supabase-miljön (NEXT_PUBLIC_SUPABASE_URL med flera). I lokal utveckling utan Supabase används demoläget utan inloggning.",
  };
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Fyll i e-post och lösenord." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.code === "invalid_credentials") return { error: "Fel e-post eller lösenord." };
    if (error.code === "email_not_confirmed")
      return { error: "E-postadressen är inte bekräftad ännu – klicka på länken i mejlet från Driva." };
    return { error: `Inloggningen misslyckades: ${error.message}` };
  }
  redirect(safeNext(formData.get("next")));
}

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!email || !password) return { error: "Fyll i e-post och lösenord." };
  if (password.length < 8) return { error: "Lösenordet behöver minst 8 tecken." };

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    if (error.code === "user_already_exists") return { error: "Det finns redan ett konto med den e-posten. Logga in i stället." };
    if (error.code === "weak_password") return { error: "Lösenordet är för svagt – välj ett längre." };
    return { error: `Kontot kunde inte skapas: ${error.message}` };
  }
  // Med e-postbekräftelse på finns ingen session förrän länken klickats.
  if (!data.session) {
    return { notice: "Konto skapat. Bekräfta din e-postadress via länken i mejlet och logga sedan in." };
  }
  redirect("/onboarding");
}

export async function logoutAction(): Promise<void> {
  if (isSupabaseMode()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export interface OnboardingFormState {
  error?: string;
  fieldErrors?: Partial<Record<OnboardingField, string>>;
}

export async function onboardingAction(
  _prev: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  if (!isSupabaseMode()) return { error: "Onboarding kräver Supabase-miljön." };
  const result = validateOnboardingFields(readOnboardingFormData(formData));
  if (Object.keys(result.fieldErrors).length > 0) {
    const first =
      result.fieldErrors.name ??
      result.fieldErrors.orgNumber ??
      result.fieldErrors.vatNumber ??
      result.fieldErrors.address ??
      result.fieldErrors.postalCode ??
      result.fieldErrors.city ??
      result.fieldErrors.paymentMethod ??
      result.fieldErrors.bankgiro ??
      result.fieldErrors.plusgiro ??
      result.fieldErrors.bankAccount ??
      result.fieldErrors.email ??
      result.fieldErrors.phone;
    return { error: first, fieldErrors: result.fieldErrors };
  }

  await createBusinessForCurrentUser(result.values);
  redirect("/");
}
