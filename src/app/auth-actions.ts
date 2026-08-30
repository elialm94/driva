"use server";

/**
 * Autentisering: e-post + lösenord via Supabase Auth.
 * Medvetet minimalt: ingen social inloggning, ingen MFA, ingen SSO.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createBusinessForCurrentUser, getSessionUser } from "@/lib/auth/session";
import { DEMO_ACTOR_COOKIE, DEMO_SESSION_COOKIE, isDemoUserEmail } from "@/lib/auth/demo-session";
import { isSupabaseMode } from "@/lib/storage/config";

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
  redirect("/login");
}

export interface OnboardingFormState {
  error?: string;
}

export async function onboardingAction(
  _prev: OnboardingFormState,
  formData: FormData
): Promise<OnboardingFormState> {
  if (!isSupabaseMode()) return { error: "Onboarding kräver Supabase-miljön." };
  const name = String(formData.get("name") ?? "").trim();
  const orgNumber = String(formData.get("orgNumber") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  if (name.length < 2) return { error: "Ange företagets namn." };
  if (!/^\d{6}-?\d{4}$/.test(orgNumber)) return { error: "Organisationsnummer anges som NNNNNN-NNNN." };
  if (!email.includes("@")) return { error: "Ange en giltig e-postadress." };

  await createBusinessForCurrentUser({ name, orgNumber, email, phone });
  redirect("/");
}
