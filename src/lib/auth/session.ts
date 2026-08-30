/**
 * Session + tenantkontext för hela appen.
 *
 *   withBusiness(fn)      – skrivande flöde (server actions, API-routes)
 *   withBusinessRead(fn)  – sidorenderingar (save() förbjudet)
 *   withPublicBusiness()  – publika tokenflöden (offert/faktura/sajt/BankID)
 *
 * Roll är PER FÖRETAG. Ägare och redovisningskonsult delar samma data –
 * skillnaden är UI och behörighet, inte bokföringsmotor.
 */
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  createBusinessWithOwner,
  loadStateSnapshot,
  membershipsForUser,
  resolvePublicToken,
  runWithTenant,
  touchMembershipActive,
  type MembershipInfo,
  type PublicTokenKind,
} from "@/lib/storage/adapter-supabase";
import { requestSlot } from "@/lib/storage/request-scope";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BusinessRole } from "@/lib/types";
import { isAccountingRole, isOwnerRole, type CollaborationCapability, assertCan } from "@/lib/collaboration/permissions";
import {
  LOCAL_JSON_BUSINESS_ID,
  LOCAL_JSON_USER_ID,
  runAsActor,
  setTestActor,
  type CollaborationActor,
} from "@/lib/collaboration/actor";
import { ensureLocalDemoCollaboration } from "@/lib/collaboration/local-demo";
import {
  activeMembershipFor,
  activeMembershipsForUser,
  putMembership,
  touchLastActive,
  upsertUser,
  userById,
} from "@/lib/collaboration/registry";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

export const WORKSPACE_COOKIE = "driva_workspace";
export const BUSINESS_COOKIE = "driva_business";
export const LOCAL_USER_COOKIE = "driva_local_user";

export type WorkspaceKind = "owner" | "redovisning";

/** Verifierad användare från Supabase-sessionen, eller JSON-lokal aktör. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  if (!isSupabaseMode()) {
    if (process.env.DRIVA_TEST !== "1") ensureLocalDemoCollaboration();
    const store = await cookies().catch(() => null);
    const localId = store?.get(LOCAL_USER_COOKIE)?.value || LOCAL_JSON_USER_ID;
    const user = userById(localId);
    if (user) return { id: user.id, email: user.email, name: user.name };
    return { id: LOCAL_JSON_USER_ID, email: "demo@driva.local", name: "Du" };
  }
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

export async function listMemberships(userId: string): Promise<MembershipInfo[]> {
  if (isSupabaseMode()) return membershipsForUser(userId);
  return activeMembershipsForUser(userId).map((m) => ({
    businessId: m.businessId,
    role: m.role,
    lastActiveAt: m.lastActiveAt,
    invitedByUserId: m.invitedByUserId,
  }));
}

function pickMembership(
  memberships: MembershipInfo[],
  preferredBusinessId?: string | null,
  prefer?: "owner" | "accounting"
): MembershipInfo | null {
  const active = memberships.filter((m) => m.businessId);
  if (preferredBusinessId) {
    const hit = active.find((m) => m.businessId === preferredBusinessId);
    if (hit) return hit;
  }
  if (prefer === "accounting") {
    return active.find((m) => isAccountingRole(m.role)) ?? active[0] ?? null;
  }
  if (prefer === "owner") {
    return active.find((m) => isOwnerRole(m.role)) ?? active[0] ?? null;
  }
  return active[0] ?? null;
}

export async function preferredBusinessFromCookie(): Promise<string | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(BUSINESS_COOKIE)?.value?.trim();
    return raw || null;
  } catch {
    return null;
  }
}

/** Redovisning utan vald klient = Alla klienter (ingen BUSINESS_COOKIE). */
export async function resolveAccountantScope(): Promise<"current" | "all_clients"> {
  const workspace = await readWorkspaceCookie();
  if (workspace !== "redovisning") return "current";
  const preferred = await preferredBusinessFromCookie();
  return preferred ? "current" : "all_clients";
}

export async function readWorkspaceCookie(): Promise<WorkspaceKind | null> {
  try {
    const jar = await cookies();
    const raw = jar.get(WORKSPACE_COOKIE)?.value;
    return raw === "redovisning" || raw === "owner" ? raw : null;
  } catch {
    return null;
  }
}

/**
 * Inloggad användare + aktivt företag.
 * Ägar-ytan: OWNER/ADMIN/MEMBER. Konsult-only → /redovisning.
 */
export async function requireBusiness(): Promise<{
  user: SessionUser;
  businessId: string;
  role: BusinessRole;
  memberships: MembershipInfo[];
}> {
  const user = await requireUser();
  const memberships = await listMemberships(user.id);
  if (memberships.length === 0) {
    if (!isSupabaseMode()) {
      ensureLocalOwner(user);
      return {
        user,
        businessId: LOCAL_JSON_BUSINESS_ID,
        role: "owner",
        memberships: [{ businessId: LOCAL_JSON_BUSINESS_ID, role: "owner" }],
      };
    }
    redirect("/onboarding");
  }
  const preferred = await preferredBusinessFromCookie();
  const workspace = await readWorkspaceCookie();
  const ownerLike = memberships.filter((m) => isOwnerRole(m.role));
  const accountingLike = memberships.filter((m) => isAccountingRole(m.role));

  if (ownerLike.length === 0 && accountingLike.length > 0) {
    redirect("/redovisning");
  }

  const membership =
    pickMembership(memberships, preferred, workspace === "redovisning" ? "accounting" : "owner") ??
    memberships[0];
  return { user, businessId: membership.businessId, role: membership.role, memberships };
}

export async function requireOwnerBusiness(): Promise<{
  user: SessionUser;
  businessId: string;
  role: BusinessRole;
  memberships: MembershipInfo[];
}> {
  const ctx = await requireBusiness();
  if (!isOwnerRole(ctx.role)) redirect("/redovisning");
  return ctx;
}

export async function requireAccountingAccess(businessId?: string): Promise<{
  user: SessionUser;
  businessId: string;
  role: BusinessRole;
  memberships: MembershipInfo[];
}> {
  const user = await requireUser();
  const memberships = await listMemberships(user.id);
  const accounting = memberships.filter((m) => isAccountingRole(m.role));
  if (accounting.length === 0) {
    if (!isSupabaseMode() && memberships.length === 0) redirect("/");
    redirect("/");
  }
  const preferred = businessId || (await preferredBusinessFromCookie());
  const membership = pickMembership(accounting, preferred, "accounting");
  if (!membership || !isAccountingRole(membership.role)) {
    throw new Error("Du har inte åtkomst till det företaget som redovisningskonsult eller revisor.");
  }
  if (businessId && membership.businessId !== businessId) {
    throw new Error("Du har inte åtkomst till det företaget.");
  }
  return { user, businessId: membership.businessId, role: membership.role, memberships: accounting };
}

function ensureLocalOwner(user: SessionUser): void {
  if (process.env.DRIVA_TEST !== "1") ensureLocalDemoCollaboration();
  upsertUser({ id: user.id, email: user.email, name: user.name || "Du" });
  if (!activeMembershipFor(user.id, LOCAL_JSON_BUSINESS_ID)) {
    putMembership({
      businessId: LOCAL_JSON_BUSINESS_ID,
      businessName: "Mitt företag",
      userId: user.id,
      role: "owner",
      createdAt: new Date().toISOString(),
    });
  }
}

function actorFrom(user: SessionUser, businessId: string, role: BusinessRole): CollaborationActor {
  return {
    userId: user.id,
    email: user.email,
    name: user.name || user.email.split("@")[0] || "Användare",
    role,
    businessId,
  };
}

async function authorizeWrite(
  user: SessionUser,
  businessId: string,
  capability?: CollaborationCapability
): Promise<BusinessRole> {
  const memberships = await listMemberships(user.id);
  const membership = memberships.find((m) => m.businessId === businessId);
  if (!membership) {
    if (!isSupabaseMode() && businessId === LOCAL_JSON_BUSINESS_ID) return "owner";
    throw new Error("Du har inte åtkomst till det företaget.");
  }
  if (capability) {
    assertCan(membership.role, capability);
  } else if (isAccountingRole(membership.role)) {
    throw new Error("Den här åtgärden är inte tillgänglig från redovisningsytan.");
  }
  return membership.role;
}

async function resolveActiveBusiness(userId: string, explicit?: string): Promise<string> {
  const memberships = await listMemberships(userId);
  if (explicit) {
    if (!memberships.some((m) => m.businessId === explicit)) {
      throw new Error("Du har inte åtkomst till det företaget.");
    }
    return explicit;
  }
  const cookieId = await preferredBusinessFromCookie();
  if (cookieId && memberships.some((m) => m.businessId === cookieId)) return cookieId;
  if (memberships[0]) return memberships[0].businessId;
  if (!isSupabaseMode()) return LOCAL_JSON_BUSINESS_ID;
  throw new Error("Inget företag valt.");
}

/** Skrivande flöde i tenantkontext. */
export async function withBusiness<T>(
  fn: () => T | Promise<T>,
  opts: { retry?: boolean; businessId?: string; capability?: CollaborationCapability } = {}
): Promise<T> {
  if (!isSupabaseMode()) {
    const user = (await getSessionUser()) ?? {
      id: LOCAL_JSON_USER_ID,
      email: "demo@driva.local",
      name: "Du",
    };
    const businessId = opts.businessId ?? LOCAL_JSON_BUSINESS_ID;
    const role = await authorizeWrite(user, businessId, opts.capability);
    return runAsActor(actorFrom(user, businessId, role), () => fn());
  }
  const user = await requireUser();
  const businessId = await resolveActiveBusiness(user.id, opts.businessId);
  const role = await authorizeWrite(user, businessId, opts.capability);
  return runAsActor(actorFrom(user, businessId, role), () =>
    runWithTenant({ businessId, userId: user.id, access: "write", retry: opts.retry }, fn)
  );
}

/** Läsande flöde (sidorendering) i tenantkontext. save() kastar. */
export async function withBusinessRead<T>(
  fn: () => T | Promise<T>,
  opts: { businessId?: string } = {}
): Promise<T> {
  if (!isSupabaseMode()) return await fn();
  const user = await requireUser();
  const businessId = await resolveActiveBusiness(user.id, opts.businessId);
  await authorizeWrite(user, businessId);
  return runWithTenant({ businessId, userId: user.id, access: "read" }, fn);
}

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

const loadPageBusiness = cache(async (businessId?: string): Promise<void> => {
  const { user, businessId: sessionId, role } = businessId
    ? await (async () => {
        const user = await requireUser();
        const memberships = await listMemberships(user.id);
        const membership = memberships.find((m) => m.businessId === businessId);
        if (!membership) redirect("/");
        return { user, businessId, role: membership.role };
      })()
    : await requireBusiness();
  const id = businessId ?? sessionId;
  const state = await loadStateSnapshot(id);
  const slot = requestSlot();
  slot.state = state;
  slot.businessId = id;
  slot.actor = actorFrom(user, id, role);
  if (isAccountingRole(role)) {
    try {
      await touchMembershipActive(id, user.id);
    } catch {
      touchLastActive(user.id, id);
    }
  }
});

export async function ensurePageBusiness(): Promise<void> {
  if (!isSupabaseMode()) return;
  return loadPageBusiness();
}

export async function ensureAccountantPage(businessId: string): Promise<void> {
  const access = await requireAccountingAccess(businessId);
  if (!isSupabaseMode()) {
    runAsActor(actorFrom(access.user, access.businessId, access.role), () => undefined);
    touchLastActive(access.user.id, access.businessId);
    return;
  }
  return loadPageBusiness(access.businessId);
}

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

export async function createBusinessForCurrentUser(input: {
  name: string;
  orgNumber: string;
  email: string;
  phone: string;
  vatNumber?: string;
  address?: string;
  postalCode?: string;
  city?: string;
  bankgiro?: string;
  plusgiro?: string;
  bankAccount?: string;
}): Promise<string> {
  const user = await requireUser();
  const memberships = await listMemberships(user.id);
  const owned = memberships.find((m) => isOwnerRole(m.role));
  if (owned) return owned.businessId;
  return createBusinessWithOwner({ userId: user.id, ...input });
}

export { setTestActor, LOCAL_JSON_BUSINESS_ID, LOCAL_JSON_USER_ID };
export type { CollaborationActor };
