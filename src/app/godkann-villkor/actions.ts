"use server";

import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { termsAccepted, TERMS_NOT_ACCEPTED_ERROR } from "@/lib/auth/signup-flow";
import { recordTermsAcceptance, termsGateStatus } from "@/lib/legal/acceptance";
import { isSupabaseMode } from "@/lib/storage/config";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";

export interface AcceptTermsState {
  error?: string;
}

function safeNext(raw: unknown): string {
  const v = typeof raw === "string" ? raw : "";
  return v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/godkann-villkor") ? v : "/";
}

/**
 * Aktivt godkännande av aktuell villkorsversion. Körs UTAN withBusiness:
 * grinden ligger före tenantladdningen och måste fungera även när företaget
 * är skrivskyddat eller saknas (nyregistrerad utan företag).
 */
export async function acceptTermsAction(_prev: AcceptTermsState, formData: FormData): Promise<AcceptTermsState> {
  if (!isSupabaseMode()) return { error: "Villkorsgodkännande finns bara i Supabase-läget." };
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/godkann-villkor");
  if (!termsAccepted(formData.get("acceptTerms"))) return { error: TERMS_NOT_ACCEPTED_ERROR };
  try {
    const status = await termsGateStatus();
    if (status.required) {
      await recordTermsAcceptance({
        userId: user.id,
        email: user.email,
        businessId: requestSlot().businessId ?? tenantContext()?.businessId ?? undefined,
        source: "app",
      });
    }
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Godkännandet kunde inte sparas. Försök igen." };
  }
  redirect(safeNext(formData.get("next")));
}
