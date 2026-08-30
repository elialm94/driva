/**
 * Plattformsauktorisering för Driva Admin.
 *
 * Källan till sanning är ALLTID servern: verifierad Supabase Auth-session →
 * aktiv rad i platform_admins → ev. rollkrav → operationen. UI:t döljer bara
 * det som ändå skulle nekas här. Ingen admin-behörighet bor någonsin i
 * klienttillstånd, localStorage eller en query-param.
 *
 * JSON-läget (endast utveckling – produktionsgrinden i storage/config stoppar
 * det där) har en seedad dev-superadmin så adminytan går att testa lokalt:
 * /dev/som-admin byter till den identiteten. Supabase-läget rör aldrig den
 * vägen.
 *
 * Medvetet ingen import från lib/auth/session.ts – tenantsessionen importerar
 * i stället härifrån (supportläget), och cykeln undviks genom att den lilla
 * sessionsläsningen dupliceras här.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { isSupabaseMode } from "../storage/config";
import { createSupabaseServerClient } from "../supabase/server";
import { upsertUser, userById } from "../collaboration/registry";
import { uid } from "../ids";
import {
  insertPlatformAdmin,
  platformAdminByUserId,
  supportSessionById,
} from "./store";
import { PlatformAccessError, SUPER_ADMIN, type PlatformAdmin, type SupportSession } from "./types";

/** Cookie med aktiv supportsessions id. Auktoriteten ligger i DB-raden. */
export const SUPPORT_SESSION_COOKIE = "driva_support_session";

/** Supportsessioner är korta – 60 min, därefter krävs en ny med nytt skäl. */
export const SUPPORT_SESSION_TTL_MS = 60 * 60 * 1000;

/** Dev-identitet i JSON-läget (aldrig aktiv i produktion – JSON-läget är dev-only). */
export const LOCAL_PLATFORM_ADMIN_ID = "local-platform-admin";
export const LOCAL_PLATFORM_ADMIN_EMAIL = "admin@driva.internal";
export const LOCAL_PLATFORM_ADMIN_NAME = "Dev Superadmin";

const LOCAL_USER_COOKIE = "driva_local_user";

export interface PlatformSessionUser {
  id: string;
  email: string;
  name?: string;
  /** Supabase Authenticator Assurance Level – "aal2" = MFA genomförd. */
  aal?: string;
}

/** Verifierad sessionsanvändare (Supabase-claims eller JSON-lokal identitet). */
export const getPlatformSessionUser = cache(async (): Promise<PlatformSessionUser | null> => {
  if (!isSupabaseMode()) {
    const store = await cookies().catch(() => null);
    const localId = store?.get(LOCAL_USER_COOKIE)?.value;
    if (!localId) return null;
    const user = userById(localId);
    if (!user) return null;
    return { id: user.id, email: user.email, name: user.name };
  }
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return {
    id: String(claims.sub),
    email: String(claims.email ?? ""),
    aal: typeof claims.aal === "string" ? claims.aal : undefined,
  };
});

export interface PlatformAdminContext {
  admin: PlatformAdmin;
  user: PlatformSessionUser;
  /** true när MFA-kravet är uppfyllt (eller inte påslaget). */
  mfaSatisfied: boolean;
}

export function platformMfaRequired(): boolean {
  return process.env.PLATFORM_ADMIN_REQUIRE_MFA?.trim() === "1";
}

/**
 * Aktiv plattformsadmin för aktuell request, annars null.
 * Inaktiverade admins (disabled_at) räknas ALDRIG som admins.
 */
export const getPlatformAdmin = cache(async (): Promise<PlatformAdminContext | null> => {
  const user = await getPlatformSessionUser();
  if (!user) return null;
  const admin = await platformAdminByUserId(user.id);
  if (!admin || admin.disabledAt) return null;
  const mfaSatisfied = !platformMfaRequired() || user.aal === "aal2";
  return { admin, user, mfaSatisfied };
});

/**
 * Kräv plattformsadmin – för server actions. Kastar 401/403 i stället för
 * redirect så att anroparen kan visa ett ärligt fel.
 */
export async function requirePlatformAdmin(): Promise<PlatformAdminContext> {
  const ctx = await getPlatformAdmin();
  if (!ctx) {
    const user = await getPlatformSessionUser();
    throw new PlatformAccessError(
      user ? "Du har inte behörighet till Driva Admin." : "Inloggning krävs.",
      user ? 403 : 401
    );
  }
  if (!ctx.mfaSatisfied) {
    throw new PlatformAccessError(
      "Tvåfaktorsautentisering (MFA) krävs för Driva Admin i den här miljön. Logga in med din andra faktor.",
      403
    );
  }
  return ctx;
}

export async function requireSuperAdmin(): Promise<PlatformAdminContext> {
  const ctx = await requirePlatformAdmin();
  if (ctx.admin.role !== SUPER_ADMIN) {
    throw new PlatformAccessError("Endast super_admin får göra detta.", 403);
  }
  return ctx;
}

/* ------------------------------- supportläge ------------------------------- */

export interface ActiveSupportContext {
  session: SupportSession;
  admin: PlatformAdmin;
}

function sessionActive(s: SupportSession, now = Date.now()): boolean {
  return !s.endedAt && new Date(s.expiresAt).getTime() > now;
}

/**
 * Aktiv supportsession för DEN INLOGGADE plattformsadminen, annars null.
 * Kraven är kumulativa: giltig auth-session → aktiv platform_admins-rad →
 * sessionsrad som tillhör just den adminen, inte avslutad, inte utgången.
 * Cookien pekar bara ut raden – auktoriteten ligger alltid i databasen.
 */
export const activeSupportContext = cache(async (): Promise<ActiveSupportContext | null> => {
  const store = await cookies().catch(() => null);
  const sessionId = store?.get(SUPPORT_SESSION_COOKIE)?.value?.trim();
  if (!sessionId) return null;
  const ctx = await getPlatformAdmin();
  if (!ctx) return null;
  const session = await supportSessionById(sessionId);
  if (!session) return null;
  if (session.adminUserId !== ctx.admin.userId) return null;
  if (!sessionActive(session)) return null;
  return { session, admin: ctx.admin };
});

export function supportSessionIsActive(s: SupportSession, now = Date.now()): boolean {
  return sessionActive(s, now);
}

/* ------------------------ dev-superadmin (JSON-läge) ------------------------ */

/**
 * Seed:a dev-superadminen i JSON-läget. Körs aldrig i Supabase-läge och
 * aldrig i produktion (JSON-läget stoppas där av storage/config).
 */
export async function ensureLocalPlatformAdmin(): Promise<void> {
  if (isSupabaseMode()) return;
  upsertUser({ id: LOCAL_PLATFORM_ADMIN_ID, email: LOCAL_PLATFORM_ADMIN_EMAIL, name: LOCAL_PLATFORM_ADMIN_NAME });
  const existing = await platformAdminByUserId(LOCAL_PLATFORM_ADMIN_ID);
  if (existing) return;
  await insertPlatformAdmin({
    id: uid(),
    userId: LOCAL_PLATFORM_ADMIN_ID,
    role: SUPER_ADMIN,
    email: LOCAL_PLATFORM_ADMIN_EMAIL,
    name: LOCAL_PLATFORM_ADMIN_NAME,
    createdAt: new Date().toISOString(),
  });
}
