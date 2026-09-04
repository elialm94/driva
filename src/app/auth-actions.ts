"use server";

/**
 * Autentisering: e-post + lösenord via Supabase Auth.
 * Medvetet minimalt: ingen social inloggning, ingen MFA, ingen SSO.
 */
import { headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createBusinessForCurrentUser, isDemoSession } from "@/lib/auth/session";
import {
  decideSignupResult,
  isSilentExistingUser,
  mapLoginAuthError,
  safeAuthNext,
  sanitizeAuthEmail,
  validateLoginFields,
  validateSignupFields,
} from "@/lib/auth/signup-flow";
import { endDemoSession } from "@/lib/auth/demo-request";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  readOnboardingFormData,
  validateOnboardingFields,
  type OnboardingField,
} from "@/lib/onboarding";

export interface AuthFormState {
  error?: string;
  notice?: string;
  needsVerification?: boolean;
  email?: string;
}

function authUnavailable(): AuthFormState {
  return {
    error:
      "Inloggning kräver Supabase-miljön (NEXT_PUBLIC_SUPABASE_URL med flera). I lokal utveckling utan Supabase används demoläget utan inloggning.",
  };
}

/** Appens origin (för mejllänkar): env-URL:en först, annars request-headers. */
async function siteOrigin(): Promise<string | undefined> {
  const fromEnv = process.env.NEXT_PUBLIC_SITE_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (fromEnv) {
    try {
      return new URL(fromEnv.includes("://") ? fromEnv : `https://${fromEnv}`).origin;
    } catch {
      /* fall through */
    }
  }
  try {
    const h = await headers();
    const host = h.get("x-forwarded-host") || h.get("host");
    if (!host) return undefined;
    const proto = h.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  } catch {
    return undefined;
  }
}

/**
 * Vart länken i mejlet ska landa efter klick: /auth/bekrafta verifierar
 * token/kod och skickar användaren vidare (onboarding, next eller nytt
 * lösenord). OBS: URL:en måste finnas i Supabase-projektets redirect-lista.
 */
async function confirmationRedirectUrl(next?: string): Promise<string | undefined> {
  const origin = await siteOrigin();
  if (!origin) return undefined;
  const safe = next ? safeAuthNext(next) : "/";
  return safe !== "/"
    ? `${origin}/auth/bekrafta?next=${encodeURIComponent(safe)}`
    : `${origin}/auth/bekrafta`;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fieldError = validateLoginFields(email, password);
  if (fieldError) return { error: fieldError };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    const mapped = mapLoginAuthError(error.code, error.message);
    return {
      error: mapped.error,
      needsVerification: mapped.needsVerification,
      email: mapped.needsVerification ? (sanitizeAuthEmail(email) ?? undefined) : undefined,
    };
  }
  redirect(safeAuthNext(formData.get("next")));
}

export async function signupAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = typeof formData.get("next") === "string" ? String(formData.get("next")) : undefined;
  const fieldError = validateSignupFields(email, phone, password);
  const stay = (error: string): AuthFormState => ({ error });
  if (fieldError) return stay(fieldError);

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = await confirmationRedirectUrl(next);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Telefonnumret verifieras inte – det sparas på kontot (user_metadata)
      // och förifylls i onboarding. Aldrig via `phone`-fältet: det skulle
      // aktivera Supabase SMS-verifiering.
      data: { phone },
      ...(emailRedirectTo ? { emailRedirectTo } : undefined),
    },
  });
  const decision = decideSignupResult({
    authError: error ? { code: error.code, message: error.message } : null,
    silentExistingUser: !error && isSilentExistingUser(data),
    hasSession: Boolean(data.session),
    email,
    next,
  });
  if (decision.kind === "stay") return stay(decision.error);
  // replace: tillbaka-knappen ska inte återöppna ett inskickat /signup.
  redirect(decision.href, RedirectType.replace);
}

export async function resendVerificationAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = sanitizeAuthEmail(formData.get("email"));
  if (!email) return { error: "Ange en giltig e-postadress." };

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = await confirmationRedirectUrl();
  const { error } = await supabase.auth.resend({
    type: "signup",
    email,
    options: emailRedirectTo ? { emailRedirectTo } : undefined,
  });
  if (error) {
    return { error: `Bekräftelsemejlet kunde inte skickas: ${error.message}`, email };
  }
  return { notice: "Ett nytt bekräftelsemejl är skickat.", email };
}

export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = sanitizeAuthEmail(formData.get("email"));
  if (!email) return { error: "Ange en giltig e-postadress." };

  const supabase = await createSupabaseServerClient();
  const origin = await siteOrigin();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/auth/bekrafta?next=${encodeURIComponent("/uppdatera-losenord")}` : undefined,
  });
  if (error) {
    // T.ex. rate limit. "Finns inte" ger aldrig fel – inget konto-läckage här.
    return { error: `Länken kunde inte skickas: ${error.message}`, email };
  }
  return {
    notice: "Om adressen har ett konto hos oss skickar vi en återställningslänk dit. Kolla skräpposten också.",
    email,
  };
}

export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");
  if (password.length < 8) return { error: "Lösenordet behöver minst 8 tecken." };
  if (password !== confirm) return { error: "Lösenorden stämmer inte överens." };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Det nya lösenordet är samma som det gamla." };
    }
    return { error: `Lösenordet kunde inte uppdateras: ${error.message}` };
  }
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  if (await isDemoSession()) {
    // Demosessionen är besökarens egen JSON-fil: släng filen + kakorna.
    await endDemoSession();
  } else if (isSupabaseMode()) {
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut();
  }
  // Utloggad landar på landningssidan (proxyns rewrite på "/").
  redirect("/");
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
