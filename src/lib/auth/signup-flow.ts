/**
 * Post-signup-navigering och verifieringsflödets helpers.
 *
 * Password får aldrig hamna i URL, flash eller helper-returvärden.
 * E-postbekräftelse styrs av om Supabase returnerar en session vid signUp –
 * inte av lokal config.toml (prod kan ha Confirm email på även om lokal
 * supabase skulle ha enable_confirmations = false).
 */
import { looksLikePhone } from "@/lib/onboarding";

export const SIGNUP_EMAIL_PARAM = "email";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function sanitizeAuthEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  if (!email || email.length > 254) return null;
  if (/[\n\r\0]/.test(email)) return null;
  if (!EMAIL_RE.test(email)) return null;
  return email;
}

/** Endast interna sökvägar – aldrig öppna redirects eller tillbaka till auth-sidorna. */
export function safeAuthNext(raw: unknown): string {
  const value = typeof raw === "string" ? raw : "";
  if (
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.startsWith("/login") &&
    !value.startsWith("/signup")
  ) {
    return value;
  }
  return "/";
}

function firstSearchParam(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) return value[0];
  return value;
}

/** "Kolla din mejl"-sidan efter registrering. E-posten visas, next följer med. */
export function verifyEmailUrl(email: string, next?: string): string {
  const params = new URLSearchParams();
  const clean = sanitizeAuthEmail(email);
  if (clean) params.set(SIGNUP_EMAIL_PARAM, clean);
  if (next) {
    const safe = safeAuthNext(next);
    if (safe !== "/") params.set("next", safe);
  }
  const qs = params.toString();
  return qs ? `/verifiera-epost?${qs}` : "/verifiera-epost";
}

export function afterSignupDestination(input: {
  hasSession: boolean;
  email: string;
  next?: string;
}): { href: string } {
  if (input.hasSession) {
    // Bekräftelse avstängd i miljön: direkt vidare till Kom igång.
    const next = input.next ? safeAuthNext(input.next) : "/";
    if (next !== "/") return { href: next };
    return { href: "/onboarding" };
  }
  return { href: verifyEmailUrl(input.email, input.next) };
}

/**
 * Supabase döljer ibland "redan registrerad" genom att returnera user utan
 * identities och utan session. Det är inte en lyckad nyregistrering.
 */
export function isSilentExistingUser(data: {
  session?: unknown;
  user?: { identities?: unknown[] | null } | null;
}): boolean {
  if (data.session) return false;
  const identities = data.user?.identities;
  return Array.isArray(identities) && identities.length === 0;
}

export function parseLoginAuthSearch(params: {
  email?: string | string[];
  next?: string | string[];
}): {
  email: string | null;
  next: string;
} {
  return {
    email: sanitizeAuthEmail(firstSearchParam(params.email)),
    next: safeAuthNext(firstSearchParam(params.next)),
  };
}

export function mapSignupAuthError(code?: string, message?: string): string {
  if (code === "user_already_exists") {
    return "Det finns redan ett konto med den e-posten. Logga in i stället.";
  }
  if (code === "weak_password") return "Lösenordet är för svagt – välj ett längre.";
  return message ? `Kontot kunde inte skapas: ${message}` : "Kontot kunde inte skapas.";
}

export function mapLoginAuthError(
  code?: string,
  message?: string
): { error: string; needsVerification: boolean } {
  if (code === "invalid_credentials") {
    return { error: "Fel e-post eller lösenord.", needsVerification: false };
  }
  if (code === "email_not_confirmed") {
    return { error: "Bekräfta din e-postadress innan du loggar in.", needsVerification: true };
  }
  return {
    error: message ? `Inloggningen misslyckades: ${message}` : "Inloggningen misslyckades.",
    needsVerification: false,
  };
}

export function validateSignupFields(email: string, phone: string, password: string): string | null {
  if (!email || !phone || !password) return "Fyll i e-post, telefonnummer och lösenord.";
  if (!sanitizeAuthEmail(email)) return "Ange en giltig e-postadress.";
  if (!looksLikePhone(phone)) return "Ange ett giltigt telefonnummer.";
  if (password.length < 8) return "Lösenordet behöver minst 8 tecken.";
  return null;
}

export function validateLoginFields(email: string, password: string): string | null {
  if (!email || !password) return "Fyll i e-post och lösenord.";
  return null;
}

export type SignupDecision = { kind: "stay"; error: string } | { kind: "leave"; href: string };

export function decideSignupResult(input: {
  fieldError?: string | null;
  authError?: { code?: string; message?: string } | null;
  silentExistingUser?: boolean;
  hasSession: boolean;
  email: string;
  next?: string;
}): SignupDecision {
  if (input.fieldError) return { kind: "stay", error: input.fieldError };
  if (input.authError) {
    return { kind: "stay", error: mapSignupAuthError(input.authError.code, input.authError.message) };
  }
  if (input.silentExistingUser) {
    return { kind: "stay", error: mapSignupAuthError("user_already_exists") };
  }
  return { kind: "leave", href: afterSignupDestination(input).href };
}

export function loginHrefWithNext(next: string): string {
  const safe = safeAuthNext(next);
  return safe === "/" ? "/login" : `/login?next=${encodeURIComponent(safe)}`;
}

export function signupHrefWithNext(next: string): string {
  const safe = safeAuthNext(next);
  return safe === "/" ? "/signup" : `/signup?next=${encodeURIComponent(safe)}`;
}
