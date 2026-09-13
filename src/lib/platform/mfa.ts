/**
 * Riktig TOTP-MFA för Ferva Admin via Supabase Auth (spec §6).
 *
 * Vanlig e-post/lösenord- eller magic-link-inloggning är AAL1 och räknas
 * INTE som MFA. Adminytan kräver AAL2: en verifierad TOTP-faktor
 * (autentiseringsapp) som utmanas efter den vanliga inloggningen.
 *
 * Alla anrop går via serverklienten (@supabase/ssr) och verkar på den
 * inloggade användarens egen session – en admin kan aldrig registrera,
 * verifiera eller ta bort någon annans faktor härifrån. Återställning av en
 * annan admins faktorer är en separat super_admin-åtgärd via service role
 * (resetAdminMfa) som alltid auditeras.
 *
 * Inga seedade faktorer, inga reservkoder i databasen: "reservnyckeln" är
 * TOTP-hemligheten som visas EN gång vid registreringen så att admin kan
 * lägga in den i en andra app/lösenordshanterare. Vi lagrar den aldrig.
 */
import { isSupabaseMode } from "../storage/config";
import { createSupabaseServerClient } from "../supabase/server";
import { supabaseAuthAdminClient, AUTH_ADMIN_UNAVAILABLE } from "./supabase-admin";
import { writeAdminAudit } from "./audit";
import { platformAdminById } from "./store";
import { PlatformAccessError, type PlatformAdmin } from "./types";

export class MfaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MfaError";
  }
}

export interface MfaFactorInfo {
  id: string;
  friendlyName: string;
  status: "verified" | "unverified";
  createdAt: string;
}

export interface OwnMfaState {
  /** Sessionens nuvarande nivå enligt Supabase ("aal1" | "aal2"). */
  currentLevel: "aal1" | "aal2" | null;
  /** Nivån sessionen kan nå ("aal2" när en verifierad faktor finns). */
  nextLevel: "aal1" | "aal2" | null;
  verified: MfaFactorInfo[];
  unverified: MfaFactorInfo[];
}

export interface TotpEnrollment {
  factorId: string;
  /** SVG-markup från Supabase – renderas som data-URI, lagras aldrig. */
  qrCodeSvg: string;
  /** Reservnyckel (TOTP-hemlighet) – visas en gång, lagras aldrig av Ferva. */
  secret: string;
  uri: string;
}

export const MFA_ONLY_SUPABASE =
  "MFA hanteras av Supabase Auth och finns bara i Supabase-läget. Det lokala JSON-läget simulerar ingen MFA.";

/** Giltig TOTP-kod: exakt sex siffror (mellanslag tolereras). */
export function normalizeTotpCode(raw: unknown): string | null {
  const code = String(raw ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(code) ? code : null;
}

/** Vänligt namn på faktorn: kort, utan styrtecken. */
export function normalizeFactorName(raw: unknown, fallback = "Autentiseringsapp"): string {
  const name = String(raw ?? "")
    .replace(/[\p{C}]/gu, "")
    .trim()
    .slice(0, 60);
  return name || fallback;
}

function asLevel(v: string | null | undefined): "aal1" | "aal2" | null {
  return v === "aal1" || v === "aal2" ? v : null;
}

function factorInfo(f: {
  id: string;
  friendly_name?: string;
  status: string;
  created_at: string;
}): MfaFactorInfo {
  return {
    id: f.id,
    friendlyName: f.friendly_name || "Autentiseringsapp",
    status: f.status === "verified" ? "verified" : "unverified",
    createdAt: f.created_at,
  };
}

async function requireSupabase() {
  if (!isSupabaseMode()) throw new MfaError(MFA_ONLY_SUPABASE);
  return createSupabaseServerClient();
}

/** Egen MFA-status för den inloggade användaren. */
export async function ownMfaState(): Promise<OwnMfaState> {
  const supabase = await requireSupabase();
  const [factors, aal] = await Promise.all([
    supabase.auth.mfa.listFactors(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (factors.error) throw new MfaError(`Kunde inte läsa MFA-faktorer: ${factors.error.message}`);
  if (aal.error) throw new MfaError(`Kunde inte läsa sessionens säkerhetsnivå: ${aal.error.message}`);
  const all = (factors.data?.all ?? []).filter((f) => f.factor_type === "totp").map(factorInfo);
  return {
    currentLevel: asLevel(aal.data?.currentLevel),
    nextLevel: asLevel(aal.data?.nextLevel),
    verified: all.filter((f) => f.status === "verified"),
    unverified: all.filter((f) => f.status === "unverified"),
  };
}

/**
 * Starta TOTP-registrering. Avbrutna försök lämnar overifierade faktorer
 * efter sig hos Supabase; de rensas först så att en ny QR alltid är den enda
 * aktiva registreringen.
 */
export async function beginTotpEnrollment(friendlyName: string): Promise<TotpEnrollment> {
  const supabase = await requireSupabase();
  const existing = await supabase.auth.mfa.listFactors();
  for (const f of existing.data?.all ?? []) {
    if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
  }
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: "totp",
    friendlyName: normalizeFactorName(friendlyName),
  });
  if (error || !data) {
    throw new MfaError(
      `Registreringen kunde inte startas: ${error?.message ?? "okänt fel"}. Kontrollera att TOTP är påslaget under Authentication → Multi-Factor i Supabase-projektet.`
    );
  }
  return {
    factorId: data.id,
    qrCodeSvg: data.totp.qr_code,
    secret: data.totp.secret,
    uri: data.totp.uri,
  };
}

/** Slutför registreringen med första koden från appen. Sessionen blir AAL2. */
export async function completeTotpEnrollment(
  actor: Pick<PlatformAdmin, "userId" | "email" | "role">,
  factorId: string,
  code: string
): Promise<void> {
  const supabase = await requireSupabase();
  const normalized = normalizeTotpCode(code);
  if (!normalized) throw new MfaError("Ange den sexsiffriga koden från din autentiseringsapp.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized });
  if (error) throw new MfaError(`Koden godkändes inte: ${error.message}. Kontrollera klockan på enheten och försök igen.`);
  await writeAdminAudit(actor, {
    action: "admin_mfa_enrolled",
    targetType: "platform_admin",
    targetId: actor.userId,
    metadata: { factorId },
  });
}

/** Utmaning efter vanlig inloggning: verifiera kod mot en verifierad faktor. */
export async function verifyTotpChallenge(factorId: string, code: string): Promise<void> {
  const supabase = await requireSupabase();
  const normalized = normalizeTotpCode(code);
  if (!normalized) throw new MfaError("Ange den sexsiffriga koden från din autentiseringsapp.");
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: normalized });
  if (error) throw new MfaError(`Koden godkändes inte: ${error.message}.`);
}

/**
 * Ta bort en egen faktor. Kräver AAL2 i sessionen (Supabase nekar annars) –
 * det räcker alltså inte att ha stulit en aal1-session för att svaga
 * skyddet. Blir ingen verifierad faktor kvar tvingas ny registrering.
 */
export async function unenrollOwnFactor(
  actor: Pick<PlatformAdmin, "userId" | "email" | "role">,
  factorId: string
): Promise<void> {
  const supabase = await requireSupabase();
  const aal = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal.data?.currentLevel !== "aal2") {
    throw new PlatformAccessError("Verifiera din andra faktor innan du ändrar MFA-inställningar.", 403);
  }
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw new MfaError(`Faktorn kunde inte tas bort: ${error.message}`);
  await writeAdminAudit(actor, {
    action: "admin_mfa_unenrolled",
    targetType: "platform_admin",
    targetId: actor.userId,
    metadata: { factorId },
  });
}

/* ------------------------- super_admin: återställning ------------------------- */

export interface AdminMfaOverview {
  adminId: string;
  verifiedFactors: number;
  /** null när service role saknas eller uppslaget misslyckades. */
  error?: string;
}

/** Antal verifierade faktorer per admin – för teamvyn. Aldrig hemligheter. */
export async function mfaOverviewForAdmins(admins: PlatformAdmin[]): Promise<Map<string, AdminMfaOverview>> {
  const out = new Map<string, AdminMfaOverview>();
  if (!isSupabaseMode()) return out;
  const client = supabaseAuthAdminClient();
  if (!client) return out;
  await Promise.all(
    admins.map(async (a) => {
      try {
        const { data, error } = await client.auth.admin.mfa.listFactors({ userId: a.userId });
        if (error) throw error;
        const verified = (data?.factors ?? []).filter(
          (f) => f.factor_type === "totp" && f.status === "verified"
        ).length;
        out.set(a.id, { adminId: a.id, verifiedFactors: verified });
      } catch (e) {
        out.set(a.id, { adminId: a.id, verifiedFactors: 0, error: e instanceof Error ? e.message : "okänt fel" });
      }
    })
  );
  return out;
}

/**
 * Återställ MFA för en annan admin (förlorad enhet). Endast super_admin,
 * aldrig på sig själv (då räcker vanlig borttagning under AAL2), alltid med
 * angivet skäl och fullständig audit. Personen tvingas registrera ny faktor
 * vid nästa besök på /admin.
 */
export async function resetAdminMfa(
  actor: PlatformAdmin,
  targetAdminId: string,
  reason: string
): Promise<{ removed: number }> {
  if (actor.role !== "super_admin") throw new PlatformAccessError("Endast super_admin får återställa MFA.", 403);
  if (!isSupabaseMode()) throw new MfaError(MFA_ONLY_SUPABASE);
  const target = await platformAdminById(targetAdminId);
  if (!target) throw new MfaError("Adminen finns inte.");
  if (target.userId === actor.userId) {
    throw new MfaError("Du kan inte återställa din egen MFA här – ta bort faktorn under Säkerhet när du är verifierad.");
  }
  const trimmedReason = reason.trim();
  if (trimmedReason.length < 5) throw new MfaError("Ange ett skäl (minst 5 tecken) – det loggas i auditloggen.");
  const client = supabaseAuthAdminClient();
  if (!client) throw new MfaError(AUTH_ADMIN_UNAVAILABLE);
  const { data, error } = await client.auth.admin.mfa.listFactors({ userId: target.userId });
  if (error) throw new MfaError(`Kunde inte läsa faktorer: ${error.message}`);
  let removed = 0;
  for (const f of data?.factors ?? []) {
    const del = await client.auth.admin.mfa.deleteFactor({ id: f.id, userId: target.userId });
    if (del.error) throw new MfaError(`Kunde inte ta bort faktor: ${del.error.message}`);
    removed++;
  }
  await writeAdminAudit(actor, {
    action: "admin_mfa_reset",
    targetType: "platform_admin",
    targetId: target.id,
    metadata: { targetUserId: target.userId, targetEmail: target.email, removed, reason: trimmedReason.slice(0, 300) },
  });
  return { removed };
}
