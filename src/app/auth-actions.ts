"use server";

/**
 * Autentisering: e-post + lösenord via Supabase Auth.
 * Medvetet minimalt: ingen social inloggning, ingen MFA, ingen SSO.
 */
import { cookies, headers } from "next/headers";
import { redirect, RedirectType } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createBusinessForCurrentUser, getSessionUser } from "@/lib/auth/session";
import {
  decideSignupResult,
  isSilentExistingUser,
  mapLoginAuthError,
  safeAuthNext,
  sanitizeAuthEmail,
  sanitizeSignupPhone,
  validateLoginFields,
  validateNewPassword,
  validateSignupFields,
} from "@/lib/auth/signup-flow";
import { DEMO_ACTOR_COOKIE, DEMO_SESSION_COOKIE, isDemoUserEmail } from "@/lib/auth/demo-session";
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

/** Appens externa origin – för redirect-URL:er i auth-mejl. */
async function appOrigin(): Promise<string | undefined> {
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
 * Vart länken i mejlet ska landa efter klick: /auth/confirm växlar koden till
 * en session och skickar vidare (onboarding för nya konton, annars next).
 */
async function confirmationRedirectUrl(next?: string): Promise<string | undefined> {
  const origin = await appOrigin();
  if (!origin) return undefined;
  const safe = next ? safeAuthNext(next) : "/";
  return safe === "/" ? `${origin}/auth/confirm` : `${origin}/auth/confirm?next=${encodeURIComponent(safe)}`;
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
      // Telefonen verifieras inte – den sparas som metadata och prefyller
      // onboardingens kontaktfält efter e-postbekräftelsen.
      data: { phone: sanitizeSignupPhone(phone) },
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
  const next = typeof formData.get("next") === "string" ? String(formData.get("next")) : undefined;

  const supabase = await createSupabaseServerClient();
  const emailRedirectTo = await confirmationRedirectUrl(next);
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

export async function logoutAction(): Promise<void> {
  if (isSupabaseMode()) {
    const supabase = await createSupabaseServerClient();
    const user = await getSessionUser();
    if (user && isDemoUserEmail(user.email)) {
      // Demo-användaren delas av alla demosessioner: släpp bara DENNA
      // besökares tokens, annars loggas alla andra demobesökare ut.
      await supabase.auth.signOut({ scope: "local" });
      const jar = await cookies();
      for (const name of [DEMO_SESSION_COOKIE, DEMO_ACTOR_COOKIE]) {
        jar.set(name, "", { path: "/", maxAge: 0, sameSite: "lax" });
        jar.delete(name);
      }
    } else {
      await supabase.auth.signOut();
    }
  }
  // Utloggad landar på landningssidan (/) – inte på inloggningsformuläret.
  redirect("/");
}

/** Glömt lösenord: skicka återställningsmejl. Avslöjar inte om kontot finns. */
export async function requestPasswordResetAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const email = sanitizeAuthEmail(formData.get("email"));
  if (!email) return { error: "Ange en giltig e-postadress." };

  const supabase = await createSupabaseServerClient();
  const redirectTo = await confirmationRedirectUrl("/aterstall-losenord");
  const { error } = await supabase.auth.resetPasswordForEmail(
    email,
    redirectTo ? { redirectTo } : undefined
  );
  if (error && error.status === 429) {
    return { error: "För många försök – vänta en stund och försök igen.", email };
  }
  // Samma svar oavsett om kontot finns (ingen user enumeration).
  return {
    notice: "Om e-postadressen har ett konto skickar vi en återställningslänk dit.",
    email,
  };
}

/** Sätt nytt lösenord – kräver session från återställningslänken. */
export async function updatePasswordAction(
  _prev: AuthFormState,
  formData: FormData
): Promise<AuthFormState> {
  if (!isSupabaseMode()) return authUnavailable();
  const password = String(formData.get("password") ?? "");
  const fieldError = validateNewPassword(password);
  if (fieldError) return { error: fieldError };

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    if (error.code === "same_password") {
      return { error: "Det nya lösenordet är samma som det gamla – välj ett annat." };
    }
    return { error: `Lösenordet kunde inte uppdateras: ${error.message}` };
  }
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
