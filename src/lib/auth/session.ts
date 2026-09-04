/**
 * Session + tenantkontext för hela appen.
 *
 *   withBusiness(fn)      – skrivande flöde (server actions, API-routes)
 *   withBusinessRead(fn)  – sidorenderingar (save() förbjudet)
 *   withPublicBusiness()  – publika tokenflöden (offert/faktura/sajt)
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
import { runInTenantContext, type TenantContext } from "@/lib/storage/context";
import {
  ensureDemoSessionState,
  persistDemoSessionState,
} from "@/lib/storage/demo-session-store";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { BusinessRole, DB } from "@/lib/types";
import { isAccountingRole, isOwnerRole, type CollaborationCapability, assertCan } from "@/lib/collaboration/permissions";
import {
  LOCAL_JSON_ACCOUNTANT_NAME,
  LOCAL_JSON_BUSINESS_ID,
  LOCAL_JSON_USER_ID,
  runAsActor,
  setTestActor,
  type CollaborationActor,
} from "@/lib/collaboration/actor";
import { DEMO_ACTOR_COOKIE, rateLimitDemoWrite } from "@/lib/auth/demo-session";
import { demoBusinessIdFor, demoUserIdFor, readDemoSessionId } from "@/lib/auth/demo-request";
import { ensureLocalDemoCollaboration } from "@/lib/collaboration/local-demo";
import {
  activeMembershipFor,
  activeMembershipsForUser,
  putMembership,
  touchLastActive,
  upsertUser,
  userById,
} from "@/lib/collaboration/registry";
import { activeSupportContext, type ActiveSupportContext } from "@/lib/platform/auth";
import { writeAdminAudit } from "@/lib/platform/audit";
import { platformRegistry } from "@/lib/platform/registry";

export interface SessionUser {
  id: string;
  email: string;
  name?: string;
}

export const WORKSPACE_COOKIE = "driva_workspace";
export const BUSINESS_COOKIE = "driva_business";
export const LOCAL_USER_COOKIE = "driva_local_user";

export type WorkspaceKind = "owner" | "redovisning";

/** Minimala JWT-claims sessionslagret läser (verifierade av Supabase-klienten). */
type SessionClaims = { sub?: unknown; email?: unknown };

/** Verifierade JWT-claims från Supabase-sessionen (en getClaims per request). */
const sessionClaims = cache(async (): Promise<SessionClaims | null> => {
  if (!isSupabaseMode()) return null;
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  if (!claims?.sub) return null;
  return claims as SessionClaims;
});

/**
 * Aktiv demosession för requesten (session-id ur demo-cookien), eller null.
 * En RIKTIG inloggning vinner alltid: en inloggad användare med kvarglömd
 * demokaka fortsätter mot Supabase – demofilen läses aldrig för den.
 */
const demoRequestSessionId = cache(async (): Promise<string | null> => {
  if (isSupabaseMode() && (await sessionClaims())?.sub) return null;
  return readDemoSessionId();
});

/** Verifierad användare från Supabase-sessionen, demosessionen eller JSON-lokal aktör. */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  const demoId = await demoRequestSessionId();
  if (demoId) {
    // Demosessionen presenteras som "Du" (som lokala demon) – och som Anna
    // Svensson när det demo-lokala konsultbytet är aktivt.
    const name = (await readDemoActorCookie()) === "accountant" ? LOCAL_JSON_ACCOUNTANT_NAME : "Du";
    return { id: demoUserIdFor(demoId), email: "demo@driva.local", name };
  }
  if (!isSupabaseMode()) {
    if (process.env.DRIVA_TEST !== "1") ensureLocalDemoCollaboration();
    const store = await cookies().catch(() => null);
    const localId = store?.get(LOCAL_USER_COOKIE)?.value || LOCAL_JSON_USER_ID;
    const user = userById(localId);
    if (user) return { id: user.id, email: user.email, name: user.name };
    return { id: LOCAL_JSON_USER_ID, email: "demo@driva.local", name: "Du" };
  }
  const claims = await sessionClaims();
  if (!claims?.sub) return null;
  return { id: String(claims.sub), email: String(claims.email ?? "") };
});

/** Demo-only aktörsbyte (Anna-vyn). Läses aldrig för riktiga användare. */
async function readDemoActorCookie(): Promise<"accountant" | null> {
  try {
    const jar = await cookies();
    return jar.get(DEMO_ACTOR_COOKIE)?.value === "accountant" ? "accountant" : null;
  } catch {
    return null;
  }
}

/** Demosessionens roll: ägare, eller redovisningskonsult i Anna-vyn. */
async function demoSessionRole(): Promise<BusinessRole> {
  return (await readDemoActorCookie()) === "accountant" ? "accounting_consultant" : "owner";
}

/**
 * Demosessionens medlemskap: EXAKT ett – sessionens eget demoföretag
 * (fil-storen). I Anna-vyn presenteras det som redovisningskonsult; bara en
 * VY på samma session – ingen annan session och inget riktigt företag kan
 * någonsin dyka upp här. Konsultvyn speglas till det instanslokala registret
 * så klientlistan i /redovisning fungerar (visning – auktoriseringen är
 * medlemslistan här).
 */
async function demoMemberships(sessionId: string, userId: string): Promise<MembershipInfo[]> {
  const businessId = demoBusinessIdFor(sessionId);
  const role = await demoSessionRole();
  if (isAccountingRole(role) && !activeMembershipFor(userId, businessId)) {
    const now = new Date().toISOString();
    putMembership({
      businessId,
      businessName: ensureDemoSessionState(sessionId).settings.name,
      userId,
      role,
      acceptedAt: now,
      lastActiveAt: now,
      createdAt: now,
    });
  }
  return [{ businessId, role }];
}

/** Kräver inloggning – annars till /login (proxyn bevarar next-param). */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}

/** Är requesten en publik demosession? (Giltig demo-cookie, ingen riktig inloggning.) */
export async function isDemoSession(): Promise<boolean> {
  return (await demoRequestSessionId()) !== null;
}

/** Telefonnumret från registreringen (user_metadata) – förifyller onboarding. */
export async function sessionPhoneHint(): Promise<string> {
  if (!isSupabaseMode()) return "";
  const claims = (await sessionClaims()) as { user_metadata?: { phone?: unknown } } | null;
  const phone = claims?.user_metadata?.phone;
  return typeof phone === "string" ? phone : "";
}

/**
 * Medlemskap per request: layout, sida och åtgärdsvakter frågar alla efter
 * samma lista – React cache() deduperar till EN databasfråga per request.
 * Muterade medlemskap (invite/revoke) följs alltid av redirect, så en
 * memoiserad läsning kan aldrig ge inaktuell auktorisering inom en request.
 */
export const listMemberships = cache(async (userId: string): Promise<MembershipInfo[]> => {
  const demoId = await demoRequestSessionId();
  if (demoId && userId === demoUserIdFor(demoId)) {
    return demoMemberships(demoId, userId);
  }
  const base = isSupabaseMode()
    ? await membershipsForUser(userId)
    : activeMembershipsForUser(userId)
        // Företag som inaktiverats av Driva Admin nekas (Supabase-läget
        // filtrerar samma sak i SQL:en; supportsessionen nedan går förbi).
        .filter((m) => !platformRegistry().disabledBusinesses.some((d) => d.businessId === m.businessId))
        .map((m) => ({
          businessId: m.businessId,
          role: m.role,
          lastActiveAt: m.lastActiveAt,
          invitedByUserId: m.invitedByUserId,
        }));

  // SUPPORTLÄGE (Driva Admin): en aktiv, tidsbegränsad supportsession ger
  // adminen ett syntetiskt ägar-medlemskap i EXAKT sessionens företag.
  const support = await activeSupportContext().catch(() => null);
  if (support && support.admin.userId === userId) {
    return [
      { businessId: support.session.businessId, role: "owner" as BusinessRole },
      ...base.filter((m) => m.businessId !== support.session.businessId),
    ];
  }
  return base;
});

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

/** Supportläge: aktören märks tydligt som Driva-support i aktivitetsflödet. */
function labelSupportActor(actor: CollaborationActor, support: ActiveSupportContext | null): CollaborationActor {
  if (!support || support.session.businessId !== actor.businessId) return actor;
  const base = support.admin.name || support.admin.email || actor.name;
  return { ...actor, name: `${base} (Driva-support)` };
}

/** Alla skrivningar under supportläge auditeras med adminen som aktör. */
async function auditSupportWrite(support: ActiveSupportContext | null, businessId: string): Promise<void> {
  if (!support || support.session.businessId !== businessId) return;
  try {
    await writeAdminAudit(support.admin, {
      action: "support_write",
      targetType: "support_session",
      targetId: support.session.id,
      businessId,
      metadata: { reason: support.session.reason },
    });
  } catch {
    // Auditfel får inte stoppa kundflödet – huvudauditen (tenantens
    // audit_log med actor_user_id = adminens uuid) skrivs ändå i commiten.
  }
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

/**
 * Demosessionens tenantkontext: sessionens JSON-fil är hela världen.
 *
 * Tillståndet lastas från fil-storen (samma objekt per instans – parallella
 * requests i samma session delar det, precis som den globala JSON-storen),
 * fn körs i samma AsyncLocalStorage-kontext som Supabase-vägen använder –
 * db()/save() i domänlagret är helt oförändrade – och vid save() skrivs
 * HELA filen ner igen. Ingen diffning, ingen SQL: demorequests rör aldrig
 * Supabase, och riktiga användare passerar aldrig genom den här vägen.
 */
async function runInDemoSession<T>(
  sessionId: string,
  opts: { access: "read" | "write"; actor?: CollaborationActor },
  fn: () => T | Promise<T>
): Promise<T> {
  const state = ensureDemoSessionState(sessionId);
  const ctx: TenantContext = {
    businessId: demoBusinessIdFor(sessionId),
    userId: opts.actor?.userId ?? null,
    writable: opts.access === "write",
    state,
    // Ingen diffning för filskrivningen – baslinjen används aldrig här.
    baseline: state,
    stateVersion: 0,
    dirty: false,
  };
  const run = () => runInTenantContext(ctx, () => fn());
  try {
    return opts.actor ? await runAsActor(opts.actor, run) : await run();
  } finally {
    // finally: även flöden som avslutas med redirect() får sina ändringar
    // sparade (tillståndet i minnet är redan muterat – filen ska spegla det).
    if (ctx.dirty) persistDemoSessionState(sessionId, state);
  }
}

/** Auktoriserat demoflöde (server actions/sidor): roll + ev. capability + skrivtak. */
async function withDemoSession<T>(
  sessionId: string,
  fn: () => T | Promise<T>,
  opts: { access: "read" | "write"; businessId?: string; capability?: CollaborationCapability }
): Promise<T> {
  const businessId = demoBusinessIdFor(sessionId);
  if (opts.businessId && opts.businessId !== businessId) {
    throw new Error("Du har inte åtkomst till det företaget.");
  }
  const user = await requireUser();
  const role = await demoSessionRole();
  if (opts.access === "write") {
    if (opts.capability) {
      assertCan(role, opts.capability);
    } else if (isAccountingRole(role)) {
      throw new Error("Den här åtgärden är inte tillgänglig från redovisningsytan.");
    }
    // Skrivtak per demosession (skydd mot skriptad massgenerering) –
    // riktiga företag berörs aldrig av kontrollen.
    if (!rateLimitDemoWrite(businessId)) {
      throw new Error("Demon har ett tempotak för ändringar. Vänta en liten stund och försök igen.");
    }
  }
  return runInDemoSession(sessionId, { access: opts.access, actor: actorFrom(user, businessId, role) }, fn);
}

/** Skrivande flöde i tenantkontext. */
export async function withBusiness<T>(
  fn: () => T | Promise<T>,
  opts: { retry?: boolean; businessId?: string; capability?: CollaborationCapability } = {}
): Promise<T> {
  const demoId = await demoRequestSessionId();
  if (demoId) {
    return withDemoSession(demoId, fn, {
      access: "write",
      businessId: opts.businessId,
      capability: opts.capability,
    });
  }
  const support = await activeSupportContext().catch(() => null);
  if (!isSupabaseMode()) {
    const user = (await getSessionUser()) ?? {
      id: LOCAL_JSON_USER_ID,
      email: "demo@driva.local",
      name: "Du",
    };
    const businessId = opts.businessId ?? LOCAL_JSON_BUSINESS_ID;
    const role = await authorizeWrite(user, businessId, opts.capability);
    try {
      return await runAsActor(labelSupportActor(actorFrom(user, businessId, role), support), () => fn());
    } finally {
      // finally: även flöden som avslutas med redirect() auditeras.
      await auditSupportWrite(support, businessId);
    }
  }
  const user = await requireUser();
  const businessId = await resolveActiveBusiness(user.id, opts.businessId);
  const role = await authorizeWrite(user, businessId, opts.capability);
  try {
    return await runAsActor(labelSupportActor(actorFrom(user, businessId, role), support), () =>
      runWithTenant({ businessId, userId: user.id, access: "write", retry: opts.retry }, fn)
    );
  } finally {
    await auditSupportWrite(support, businessId);
  }
}

/** Läsande flöde (sidorendering) i tenantkontext. save() kastar. */
export async function withBusinessRead<T>(
  fn: () => T | Promise<T>,
  opts: { businessId?: string } = {}
): Promise<T> {
  const demoId = await demoRequestSessionId();
  if (demoId) return withDemoSession(demoId, fn, { access: "read", businessId: opts.businessId });
  if (!isSupabaseMode()) return await fn();
  const user = await requireUser();
  const businessId = await resolveActiveBusiness(user.id, opts.businessId);
  await authorizeWrite(user, businessId);
  return runWithTenant({ businessId, userId: user.id, access: "read" }, fn);
}

/**
 * Finns den publika tokenen i demosessionens eget tillstånd? Publika länkar
 * (offert/faktura/sajt/BankID) som skapats i demon lever i sessionens fil –
 * inte i databasen – och fungerar därför i besökarens egen webbläsare.
 * Ingen träff = ingen demoväg: riktiga publika länkar fortsätter fungera
 * som vanligt även med en demokaka i webbläsaren.
 */
function demoStateHasToken(state: DB, kind: PublicTokenKind, token: string): boolean {
  if (!token) return false;
  switch (kind) {
    case "quote":
      return state.quotes.some((q) => q.token === token);
    case "invoice":
      return state.invoices.some((i) => i.token === token);
    case "bankid_order":
      return state.bankidOrders.some((o) => o.orderRef === token);
    case "website":
      return state.website?.id === token;
    case "website_slug":
      return state.website?.slug === token;
    default:
      // hostname/inbound: externa kanaler (egna domäner, inkommande mejl)
      // pekar aldrig på en demosession.
      return false;
  }
}

export async function withPublicBusiness<T>(
  kind: PublicTokenKind,
  token: string,
  fn: () => T | Promise<T>,
  opts: { access?: "read" | "write"; retry?: boolean } = {}
): Promise<T | null> {
  const demoId = await demoRequestSessionId();
  if (demoId && demoStateHasToken(ensureDemoSessionState(demoId), kind, token)) {
    return runInDemoSession(demoId, { access: opts.access ?? "write" }, fn);
  }
  if (!isSupabaseMode()) return await fn();
  const resolved = await resolvePublicToken(kind, token);
  if (!resolved) return null;
  return runWithTenant(
    { businessId: resolved.businessId, userId: null, access: opts.access ?? "write", retry: opts.retry },
    fn
  );
}

/** Skriv last_active_at högst så här ofta – aldrig en write per sidladdning. */
const TOUCH_ACTIVE_MIN_INTERVAL_MS = 60_000;

function membershipNeedsTouch(lastActiveAt: string | undefined): boolean {
  if (!lastActiveAt) return true;
  const last = Date.parse(lastActiveAt);
  if (Number.isNaN(last)) return true;
  return Date.now() - last > TOUCH_ACTIVE_MIN_INTERVAL_MS;
}

const loadPageBusiness = cache(async (businessId?: string): Promise<void> => {
  const { user, businessId: sessionId, role, memberships } = businessId
    ? await (async () => {
        const user = await requireUser();
        const memberships = await listMemberships(user.id);
        const membership = memberships.find((m) => m.businessId === businessId);
        if (!membership) redirect("/");
        return { user, businessId, role: membership.role, memberships };
      })()
    : await requireBusiness();
  const id = businessId ?? sessionId;
  const state = await loadStateSnapshot(id);
  const slot = requestSlot();
  slot.state = state;
  slot.businessId = id;
  slot.actor = labelSupportActor(actorFrom(user, id, role), await activeSupportContext().catch(() => null));
  if (isAccountingRole(role)) {
    // Debouncad aktivitetsstämpel: "aktiv idag"-indikatorn behöver inte en
    // databas-write per navigering.
    const membership = memberships.find((m) => m.businessId === id);
    if (membershipNeedsTouch(membership?.lastActiveAt)) {
      try {
        await touchMembershipActive(id, user.id);
      } catch {
        touchLastActive(user.id, id);
      }
    }
  }
});

/**
 * Demosessionens sidladdning: sessionens filtillstånd in i request-cellen,
 * så att db() i nästlade serverkomponenter läser rätt fil – i BÅDA
 * lagringslägena. Sidorenderingar muterar aldrig (save() utan skrivkontext
 * kastar i Supabase-läget och demoflödenas skrivningar går via withBusiness).
 */
const loadDemoPage = cache(async (sessionId: string): Promise<void> => {
  const user = await requireUser();
  const businessId = demoBusinessIdFor(sessionId);
  const slot = requestSlot();
  slot.state = ensureDemoSessionState(sessionId);
  slot.businessId = businessId;
  slot.actor = actorFrom(user, businessId, await demoSessionRole());
});

export async function ensurePageBusiness(): Promise<void> {
  const demoId = await demoRequestSessionId();
  if (demoId) return loadDemoPage(demoId);
  if (!isSupabaseMode()) return;
  return loadPageBusiness();
}

export async function ensureAccountantPage(businessId: string): Promise<void> {
  const access = await requireAccountingAccess(businessId);
  const demoId = await demoRequestSessionId();
  if (demoId) return loadDemoPage(demoId);
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

const loadDemoPublicPage = cache(async (sessionId: string): Promise<void> => {
  const slot = requestSlot();
  slot.state = ensureDemoSessionState(sessionId);
  slot.businessId = demoBusinessIdFor(sessionId);
});

export async function ensurePublicPage(kind: PublicTokenKind, token: string): Promise<boolean> {
  const demoId = await demoRequestSessionId();
  if (demoId && demoStateHasToken(ensureDemoSessionState(demoId), kind, token)) {
    await loadDemoPublicPage(demoId);
    return true;
  }
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
