"use server";

/**
 * Server actions för TOTP-MFA i Ferva Admin. Varje action verifierar att
 * anroparen är inloggad, aktiv plattformsadmin (requirePlatformAdminPreMfa) –
 * AAL2 krävs inte här eftersom det är just den nivån som ska uppnås.
 * Faktorerna hör alltid till den egna sessionen (Supabase MFA-API).
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePlatformAdminPreMfa, requireSuperAdmin } from "@/lib/platform/auth";
import {
  MfaError,
  beginTotpEnrollment,
  completeTotpEnrollment,
  resetAdminMfa,
  unenrollOwnFactor,
  verifyTotpChallenge,
} from "@/lib/platform/mfa";
import { PlatformAccessError } from "@/lib/platform/types";
import type { AdminActionState } from "./actions";

export interface MfaEnrollState extends AdminActionState {
  factorId?: string;
  qrCodeSvg?: string;
  secret?: string;
  uri?: string;
}

function mfaError(e: unknown, fallback: string): { error: string } {
  if (e instanceof MfaError || e instanceof PlatformAccessError) return { error: e.message };
  return { error: e instanceof Error ? e.message : fallback };
}

export async function beginMfaEnrollmentAction(
  _prev: MfaEnrollState,
  formData: FormData
): Promise<MfaEnrollState> {
  try {
    await requirePlatformAdminPreMfa();
    const enrollment = await beginTotpEnrollment(String(formData.get("friendlyName") ?? ""));
    return {
      factorId: enrollment.factorId,
      qrCodeSvg: enrollment.qrCodeSvg,
      secret: enrollment.secret,
      uri: enrollment.uri,
    };
  } catch (e) {
    return mfaError(e, "Registreringen kunde inte startas.");
  }
}

export async function completeMfaEnrollmentAction(
  prev: MfaEnrollState,
  formData: FormData
): Promise<MfaEnrollState> {
  let done = false;
  try {
    const ctx = await requirePlatformAdminPreMfa();
    const factorId = String(formData.get("factorId") ?? "");
    if (!factorId) return { ...prev, error: "Starta registreringen på nytt." };
    await completeTotpEnrollment(ctx.admin, factorId, String(formData.get("code") ?? ""));
    done = true;
  } catch (e) {
    return { ...prev, ...mfaError(e, "Koden kunde inte verifieras.") };
  }
  if (done) {
    revalidatePath("/admin", "layout");
    redirect("/admin?mfa=klar");
  }
  return prev;
}

export async function verifyMfaChallengeAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  let done = false;
  try {
    await requirePlatformAdminPreMfa();
    const factorId = String(formData.get("factorId") ?? "");
    if (!factorId) return { error: "Ingen faktor vald." };
    await verifyTotpChallenge(factorId, String(formData.get("code") ?? ""));
    done = true;
  } catch (e) {
    return mfaError(e, "Koden kunde inte verifieras.");
  }
  if (done) {
    revalidatePath("/admin", "layout");
    redirect(safeNext(formData.get("next")));
  }
  return {};
}

export async function unenrollMfaFactorAction(formData: FormData): Promise<AdminActionState> {
  try {
    const ctx = await requirePlatformAdminPreMfa();
    await unenrollOwnFactor(ctx.admin, String(formData.get("factorId") ?? ""));
    revalidatePath("/admin/mfa");
    revalidatePath("/admin", "layout");
    return { notice: "Faktorn är borttagen." };
  } catch (e) {
    return mfaError(e, "Faktorn kunde inte tas bort.");
  }
}

/** super_admin: återställ en annan admins MFA (förlorad enhet). Auditeras alltid. */
export async function resetAdminMfaAction(
  _prev: AdminActionState,
  formData: FormData
): Promise<AdminActionState> {
  try {
    const ctx = await requireSuperAdmin();
    const { removed } = await resetAdminMfa(
      ctx.admin,
      String(formData.get("adminId") ?? ""),
      String(formData.get("reason") ?? "")
    );
    revalidatePath("/admin/admins");
    return {
      notice:
        removed === 0
          ? "Inga faktorer fanns att ta bort – personen får registrera MFA vid nästa besök."
          : `${removed} faktor${removed === 1 ? "" : "er"} borttagna. Personen måste registrera en ny autentiseringsapp vid nästa besök på /admin.`,
    };
  } catch (e) {
    return mfaError(e, "MFA kunde inte återställas.");
  }
}

/** Endast interna adminvägar får vara mål efter utmaningen. */
function safeNext(raw: unknown): string {
  const value = String(raw ?? "");
  if (value.startsWith("/admin") && !value.startsWith("//") && !value.includes("://")) return value;
  return "/admin";
}
