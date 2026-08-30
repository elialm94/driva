"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/store";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  BUSINESS_COOKIE,
  LOCAL_USER_COOKIE,
  WORKSPACE_COOKIE,
  isDemoSession,
  requireOwnerBusiness,
  requireUser,
  withBusiness,
} from "@/lib/auth/session";
import { DEMO_ACTOR_COOKIE } from "@/lib/auth/demo-session";
import {
  LOCAL_JSON_ACCOUNTANT_ID,
  LOCAL_JSON_BUSINESS_ID,
  LOCAL_JSON_USER_ID,
} from "@/lib/collaboration/actor";
import { restoreLocalAccountantDemo } from "@/lib/collaboration/local-demo";
import { activeMembershipFor } from "@/lib/collaboration/registry";
import { isAccountingRole } from "@/lib/collaboration/permissions";
import { currentActor } from "@/lib/collaboration/actor";
import { assertCan } from "@/lib/collaboration/permissions";
import { CollaborationError } from "@/lib/collaboration/invitations";
import { CollaborationDeniedError } from "@/lib/collaboration/permissions";
import { requestClientInformation } from "@/lib/collaboration/requests";
import {
  acceptCollaboratorInvite,
  hydrateInvitationsFromTenant,
  inviteCollaborator,
  resendCollaboratorInvite,
  revokeCollaborator,
} from "@/lib/collaboration/service";
import { upsertUser } from "@/lib/collaboration/registry";
import type { CollaborationRole } from "@/lib/types";

function refresh() {
  revalidatePath("/", "layout");
  revalidatePath("/samarbeta");
  revalidatePath("/redovisning");
}

export type InviteState = { error?: string; notice?: string };

export async function inviteCollaboratorAction(
  _prev: InviteState,
  formData: FormData
): Promise<InviteState> {
  const email = String(formData.get("email") ?? "").trim();
  // Samarbeta bjuder alltid in som redovisningskonsult. Rollen sätts på servern
  // och tas aldrig från formuläret. (Revisor finns kvar i domänmodellen internt.)
  const role: CollaborationRole = "accounting_consultant";
  try {
    return await withBusiness(
      async () => {
        const actor = currentActor();
        const user = actor
          ? { id: actor.userId, email: actor.email, name: actor.name }
          : await requireUser();
        assertCan(actor?.role ?? "owner", "invite_collaborator");
        hydrateInvitationsFromTenant(actor?.businessId ?? LOCAL_JSON_BUSINESS_ID);
        const result = await inviteCollaborator({
          businessId: actor?.businessId ?? LOCAL_JSON_BUSINESS_ID,
          businessName: db().settings.name,
          email,
          role,
          invitedByUserId: user.id,
          invitedByName: user.name || user.email.split("@")[0] || "Ägaren",
        });
        refresh();
        return {
          notice: result.mailOk
            ? `Inbjudan skickad till ${email}.`
            : `Inbjudan skapad. Mejlet kunde inte skickas – be dem öppna länken manuellt.`,
        };
      },
      { capability: "invite_collaborator", retry: false }
    );
  } catch (e) {
    if (e instanceof CollaborationError || e instanceof CollaborationDeniedError) {
      return { error: e.message };
    }
    return { error: e instanceof Error ? e.message : "Kunde inte skicka inbjudan." };
  }
}

export async function resendCollaboratorInviteAction(formData: FormData): Promise<InviteState> {
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  if (!invitationId) return { error: "Inbjudan saknas." };
  try {
    return await withBusiness(
      async () => {
        const actor = currentActor();
        assertCan(actor?.role ?? "owner", "invite_collaborator");
        const result = await resendCollaboratorInvite({
          invitationId,
          companyName: db().settings.name,
        });
        refresh();
        return {
          notice: result.mailOk ? "Inbjudan skickad igen." : "Inbjudan uppdaterad. Mejlet kunde inte skickas.",
        };
      },
      { capability: "invite_collaborator", retry: false }
    );
  } catch (e) {
    if (e instanceof CollaborationError || e instanceof CollaborationDeniedError) {
      return { error: e.message };
    }
    return { error: e instanceof Error ? e.message : "Kunde inte skicka igen." };
  }
}

export async function revokeCollaboratorAction(formData: FormData): Promise<InviteState> {
  const targetUserId = String(formData.get("userId") ?? "").trim() || undefined;
  const invitationId = String(formData.get("invitationId") ?? "").trim() || undefined;
  try {
    await withBusiness(
      async () => {
        const actor = currentActor();
        const user = actor ?? (await requireUser());
        assertCan(actor?.role ?? "owner", "revoke_collaborator");
        await revokeCollaborator({
          businessId: actor?.businessId ?? LOCAL_JSON_BUSINESS_ID,
          targetUserId,
          invitationId,
          revokedByUserId: "userId" in user ? user.userId : user.id,
          revokedByName: user.name || ("email" in user ? user.email.split("@")[0] : "Ägaren") || "Ägaren",
        });
        refresh();
      },
      { capability: "revoke_collaborator", retry: false }
    );
    return { notice: "Åtkomsten är borttagen." };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Kunde inte ta bort åtkomsten." };
  }
}

export async function acceptInviteAction(formData: FormData): Promise<void> {
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const user = await requireUser();
  const display = name || user.name || user.email.split("@")[0] || user.email;
  upsertUser({ id: user.id, email: user.email, name: display });
  const accepted = await acceptCollaboratorInvite({
    token,
    userId: user.id,
    email: user.email,
    name: display,
  });
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  jar.set(BUSINESS_COOKIE, accepted.businessId, { path: "/", sameSite: "lax" });
  refresh();
  redirect("/redovisning");
}

/** JSON-läge: byt lokal identitet (inbjuden konsult utan Supabase Auth). */
export async function continueAsInviteeAction(formData: FormData): Promise<void> {
  if (isSupabaseMode()) redirect("/login");
  const token = String(formData.get("token") ?? "");
  const name = String(formData.get("name") ?? "").trim() || "Konsult";
  const email = String(formData.get("email") ?? "").trim();
  const { uid } = await import("@/lib/ids");
  const { userByEmail } = await import("@/lib/collaboration/registry");
  const existing = userByEmail(email);
  const userId = existing?.id ?? uid();
  upsertUser({ id: userId, email, name: existing?.name || name });
  const jar = await cookies();
  jar.set(LOCAL_USER_COOKIE, userId, { path: "/", sameSite: "lax" });
  const accepted = await acceptCollaboratorInvite({ token, userId, email, name: existing?.name || name });
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  jar.set(BUSINESS_COOKIE, accepted.businessId, { path: "/", sameSite: "lax" });
  refresh();
  redirect("/redovisning");
}

export async function switchWorkspaceAction(workspace: "owner" | "redovisning", businessId?: string) {
  const jar = await cookies();
  jar.set(WORKSPACE_COOKIE, workspace, { path: "/", sameSite: "lax" });
  if (businessId) jar.set(BUSINESS_COOKIE, businessId, { path: "/", sameSite: "lax" });
  redirect(workspace === "redovisning" ? "/redovisning" : "/");
}

/**
 * Demo: öppna redovisningsytan som Anna Svensson.
 *
 *   * JSON-läget: byt lokal identitet till den seedade konsulten.
 *   * Publika demosessionen (Supabase): sätt demo-aktörskakan – sessionslagret
 *     presenterar då demoföretagets ägarmedlemskap som redovisningskonsult
 *     (endast en vy, isolerad till demoföretaget – ingen impersonering av
 *     riktiga företag finns).
 */
export async function enterLocalAccountantDemoAction(): Promise<void> {
  if (isSupabaseMode()) {
    if (!(await isDemoSession())) redirect("/login?next=/redovisning");
    const jar = await cookies();
    jar.set(DEMO_ACTOR_COOKIE, "accountant", { path: "/", sameSite: "lax", httpOnly: true });
    jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
    jar.set(BUSINESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
    jar.delete(BUSINESS_COOKIE);
    refresh();
    redirect("/redovisning");
  }
  restoreLocalAccountantDemo();
  const membership = activeMembershipFor(LOCAL_JSON_ACCOUNTANT_ID, LOCAL_JSON_BUSINESS_ID);
  if (!membership || !isAccountingRole(membership.role)) redirect("/");
  const jar = await cookies();
  jar.set(LOCAL_USER_COOKIE, LOCAL_JSON_ACCOUNTANT_ID, { path: "/", sameSite: "lax" });
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  jar.set(BUSINESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  jar.delete(BUSINESS_COOKIE);
  refresh();
  redirect("/redovisning");
}

/** Demo: tillbaka till ägaren. */
export async function leaveLocalAccountantDemoAction(): Promise<void> {
  if (isSupabaseMode()) {
    const jar = await cookies();
    jar.set(DEMO_ACTOR_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
    jar.delete(DEMO_ACTOR_COOKIE);
    jar.set(WORKSPACE_COOKIE, "owner", { path: "/", sameSite: "lax" });
    refresh();
    redirect("/");
  }
  const jar = await cookies();
  jar.set(LOCAL_USER_COOKIE, LOCAL_JSON_USER_ID, { path: "/", sameSite: "lax" });
  jar.set(WORKSPACE_COOKIE, "owner", { path: "/", sameSite: "lax" });
  jar.set(BUSINESS_COOKIE, LOCAL_JSON_BUSINESS_ID, { path: "/", sameSite: "lax" });
  refresh();
  redirect("/");
}

export async function switchClientAction(businessId: string, nextPath?: string) {
  const { requireAccountingAccess } = await import("@/lib/auth/session");
  const { safeAccountantPath } = await import("@/lib/collaboration/switch");
  await requireAccountingAccess(businessId);
  const jar = await cookies();
  jar.set(BUSINESS_COOKIE, businessId, { path: "/", sameSite: "lax" });
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  redirect(safeAccountantPath(nextPath) || `/redovisning/k/${businessId}`);
}

/** Alla klienter: rensa BUSINESS_COOKIE så AI/actions inte läcker gammalt företag. */
export async function switchToAllClientsAction(nextPath?: string) {
  const { requireUser, listMemberships } = await import("@/lib/auth/session");
  const { isAccountingRole } = await import("@/lib/collaboration/permissions");
  const { safeAccountantPath } = await import("@/lib/collaboration/switch");
  const user = await requireUser();
  const memberships = await listMemberships(user.id);
  if (!memberships.some((m) => isAccountingRole(m.role))) redirect("/");
  const jar = await cookies();
  jar.set(BUSINESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  jar.delete(BUSINESS_COOKIE);
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
  redirect(safeAccountantPath(nextPath) || "/redovisning");
}

export async function rememberAccountantClientAction(businessId: string) {
  const { requireAccountingAccess } = await import("@/lib/auth/session");
  await requireAccountingAccess(businessId);
  const jar = await cookies();
  jar.set(BUSINESS_COOKIE, businessId, { path: "/", sameSite: "lax" });
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
}

export async function clearAccountantClientCookieAction() {
  const jar = await cookies();
  jar.set(BUSINESS_COOKIE, "", { path: "/", maxAge: 0, sameSite: "lax" });
  jar.delete(BUSINESS_COOKIE);
  jar.set(WORKSPACE_COOKIE, "redovisning", { path: "/", sameSite: "lax" });
}

export async function requestClientInformationAction(input: {
  expenseId?: string;
  message?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await withBusiness(
      () => {
        const actor = currentActor();
        if (!actor) throw new Error("Du måste vara inloggad.");
        assertCan(actor.role, "request_client_information");
        if (actor.role !== "accounting_consultant" && actor.role !== "auditor") {
          /* ägare kan också be, men primär väg är konsulten */
        }
        if (actor.role === "auditor") {
          throw new CollaborationDeniedError("request_client_information", "auditor");
        }
        requestClientInformation({
          expenseId: input.expenseId,
          message: input.message,
          requestedByUserId: actor.userId,
          requestedByName: actor.name || "Redovisningskonsulten",
          requestedByRole: "accounting_consultant",
        });
        refresh();
      },
      { capability: "request_client_information" }
    );
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Kunde inte be om underlag." };
  }
}

export async function requireOwnerForSamarbeta() {
  return requireOwnerBusiness();
}
