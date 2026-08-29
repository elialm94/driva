/**
 * Session + tenantkontext för hela appen.
 *
 *   withBusiness(fn)      – skrivande flöde (server actions, API-routes)
 *   withBusinessRead(fn)  – sidorenderingar (save() förbjudet)
 *   withPublicBusiness()  – publika tokenflöden (offert/faktura/sajt/BankID)
 *
 * I Supabase-läge: verifiera Supabase-sessionen → slå upp medlemskap →
 * kör fn i tenantkontext (ladda → domänlogik → atomär commit).
 * I JSON-läge (endast utveckling/test): kör fn direkt mot det lokala lagret.
 *
 * Viktigt: fn får inte ha externa sidoeffekter (mejl) om retry är på –
 * flöden som mejlar skickar { retry: false } och delar upp sig i flera steg.
 */
import { cache } from "react";
import { redirect } from "next/navigation";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  createBusinessWithOwner,
  loadStateSnapshot,
  membershipsForUser,
  resolvePublicToken,
  runWithTenant,
  type MembershipInfo,
  type PublicTokenKind,
} from "@/lib/storage/adapter-supabase";
import { requestSlot } from "@/lib/storage/request-scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface SessionUser {
  id: string;
  email: string;
}

/** Verifierad användare från Supabase-sessionen, eller null. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseMode()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return { id: String(claims.sub), email: String(claims.email ?? "") };
});

/** Kräver inloggning – annars till /login (proxyn bevarar next-param). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

const membershipForUser = cache(async (userId: string): Promise<MembershipInfo | null> => {
  const memberships = await membershipsForUser(userId);
  return memberships[0] ?? null;
});

/**
 * Inloggad användare + aktivt företag. Saknas medlemskap → onboarding.
 * V1: en användare hör till ETT företag (första medlemskapet).
 */
export async function requireBusiness(): Promise<{ user: SessionUser; businessId: string }> {
  const user = await requireUser();
  const membership = await membershipForUser(user.id);
  if (!membership) redirect("/onboarding");
  return { user, businessId: membership.businessId };
}

/** Skrivande flöde i tenantkontext. */
export async function withBusiness<T>(
  fn: () => T | Promise<T>,
  opts: { retry?: boolean } = {}
): Promise<T> {
  if (!isSupabaseMode()) return await fn();
  const { user, businessId } = await requireBusiness();
  return runWithTenant({ businessId, userId: user.id, access: "write", retry: opts.retry }, fn);
}

/** Läsande flöde (sidorendering) i tenantkontext. save() kastar. */
export async function withBusinessRead<T>(fn: () => T | Promise<T>): Promise<T> {
  if (!isSupabaseMode()) return await fn();
  const { user, businessId } = await requireBusiness();
  return runWithTenant({ businessId, userId: user.id, access: "read" }, fn);
}

/**
 * Publikt tokenflöde: lös företaget från token (security definer-uppslag)
 * och kör fn i det företagets kontext – utan inloggning men med exakt token.
 * Returnerar null om token inte finns.
 */
export async function withPublicBusiness<T>(
  kind: PublicTokenKind,
  token: string,
  fn: () => T | Promise<T>,
  opts: { access?: "read" | "write"; retry?: boolean } = {}
): Promise<T | null> {
  if (!isSupabaseMode()) return await fn();
  const resolved = await resolvePublicToken(kind, token);
  if (!resolved) return null;
  return runWithTenant(
    { businessId: resolved.businessId, userId: null, access: opts.access ?? "write", retry: opts.retry },
    fn
  );
}

/**
 * Sidorendering: ladda inloggat företags state i requestens cell EN gång.
 * Kallas överst i varje (app)-sida OCH i (app)-layouten – layout och sida
 * renderar parallellt, så laddningen är cache():ad (promisen delas) och körs
 * exakt en gång per request. Nästlade serverkomponenter läser sedan db()
 * synkront via cellen. I JSON-läge: no-op.
 */
const loadPageBusiness = cache(async (): Promise<void> => {
  const { businessId } = await requireBusiness();
  const state = await loadStateSnapshot(businessId);
  const slot = requestSlot();
  slot.state = state;
  slot.businessId = businessId;
});

export async function ensurePageBusiness(): Promise<void> {
  if (!isSupabaseMode()) return;
  return loadPageBusiness();
}

/**
 * Publik sida (offert-/fakturalänk, publicerad sajt): lös företaget från
 * token och ladda dess state i requestens cell. Returnerar false om token
 * inte finns – sidan ska då rendera notFound().
 */
const loadPublicPage = cache(async (kind: PublicTokenKind, token: string): Promise<boolean> => {
  const resolved = await resolvePublicToken(kind, token);
  if (!resolved) return false;
  const state = await loadStateSnapshot(resolved.businessId);
  const slot = requestSlot();
  slot.state = state;
  slot.businessId = resolved.businessId;
  return true;
});

export async function ensurePublicPage(kind: PublicTokenKind, token: string): Promise<boolean> {
  if (!isSupabaseMode()) return true;
  return loadPublicPage(kind, token);
}

/** Onboarding: skapa företag + ägarmedlemskap. Returnerar företags-id. */
export async function createBusinessForCurrentUser(input: {
  name: string;
  orgNumber: string;
  email: string;
  phone: string;
}): Promise<string> {
  const user = await requireUser();
  const existing = await membershipForUser(user.id);
  if (existing) return existing.businessId;
  return createBusinessWithOwner({ userId: user.id, ...input });
}
