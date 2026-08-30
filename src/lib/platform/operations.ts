/**
 * Explicita, säkra backend-åtgärder för Driva Admin. INGEN generell SQL-yta:
 * varje åtgärd är en namngiven domänoperation som återanvänder befintliga
 * tjänster, auditeras och visar ärliga fel när miljön saknar förutsättningar
 * (t.ex. service role-nyckel). Destruktiva åtgärder policy-prövas alltid
 * (userDeletionPolicy/businessDeletionPolicy) före utförande.
 */
import { isSupabaseMode } from "../storage/config";
import { sqlClient, invitationRowById, runWithTenant } from "../storage/adapter-supabase";
import { createSupabaseServerClient } from "../supabase/server";
import { db } from "../store";
import { resendCollaboratorInvite } from "../collaboration/service";
import {
  activeMembershipsForUser,
  collaborationRegistry,
  putInvitation,
  revokeMembership,
} from "../collaboration/registry";
import { writeAdminAudit } from "./audit";
import {
  businessDeletionPolicy,
  userDeletionPolicy,
  type BusinessDeletionPolicy,
  type UserDeletionPolicy,
} from "./directory";
import { setBusinessDisabled, businessDisabledAt } from "./store";
import { AUTH_ADMIN_UNAVAILABLE, supabaseAuthAdminClient } from "./supabase-admin";
import type { PlatformAdmin } from "./types";

export class AdminOperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminOperationError";
  }
}

/* ------------------------------- Användare --------------------------------- */

/** Skicka om e-postverifiering. Kräver bara anon-nyckeln (Supabase resend-API). */
export async function resendVerificationEmail(actor: PlatformAdmin, email: string): Promise<void> {
  if (!isSupabaseMode()) {
    throw new AdminOperationError("E-postverifiering finns bara i Supabase-läget (lokalt JSON-läge saknar riktig auth).");
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.resend({ type: "signup", email });
  if (error) throw new AdminOperationError(`Verifieringsmejlet kunde inte skickas: ${error.message}`);
  await writeAdminAudit(actor, {
    action: "user_verification_resent",
    targetType: "user",
    targetId: email,
  });
}

const BAN_DURATION_DISABLED = "87600h"; // ~10 år – "tills vidare" utan magiska datum.

export async function disableUserAccount(actor: PlatformAdmin, userId: string, email: string): Promise<void> {
  if (!isSupabaseMode()) {
    throw new AdminOperationError("Konto-inaktivering kräver Supabase-läget (lokalt JSON-läge saknar riktig auth).");
  }
  const client = supabaseAuthAdminClient();
  if (!client) throw new AdminOperationError(AUTH_ADMIN_UNAVAILABLE);
  const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: BAN_DURATION_DISABLED });
  if (error) throw new AdminOperationError(`Kontot kunde inte inaktiveras: ${error.message}`);
  await writeAdminAudit(actor, {
    action: "user_disabled",
    targetType: "user",
    targetId: userId,
    metadata: { email },
  });
}

export async function enableUserAccount(actor: PlatformAdmin, userId: string, email: string): Promise<void> {
  if (!isSupabaseMode()) {
    throw new AdminOperationError("Konto-återställning kräver Supabase-läget.");
  }
  const client = supabaseAuthAdminClient();
  if (!client) throw new AdminOperationError(AUTH_ADMIN_UNAVAILABLE);
  const { error } = await client.auth.admin.updateUserById(userId, { ban_duration: "none" });
  if (error) throw new AdminOperationError(`Kontot kunde inte återställas: ${error.message}`);
  await writeAdminAudit(actor, {
    action: "user_enabled",
    targetType: "user",
    targetId: userId,
    metadata: { email },
  });
}

/**
 * Radera användare enligt domänpolicyn (aldrig blind auth-radering):
 * policyn måste ge canDelete, annars vägrar servern oavsett UI.
 * Bokföringsdata bevaras alltid – företag med historik blockerar radering.
 */
export async function deleteUserAccount(
  actor: PlatformAdmin,
  userId: string,
  email: string
): Promise<UserDeletionPolicy> {
  const policy = await userDeletionPolicy(userId);
  if (!policy.canDelete) {
    throw new AdminOperationError(`Kontot kan inte raderas: ${policy.blockers.join(" ")}`);
  }

  if (!isSupabaseMode()) {
    for (const m of activeMembershipsForUser(userId)) revokeMembership(userId, m.businessId);
    const reg = collaborationRegistry();
    reg.users = reg.users.filter((u) => u.id !== userId);
    await writeAdminAudit(actor, {
      action: "user_deleted",
      targetType: "user",
      targetId: userId,
      metadata: { email, businessesDeleted: policy.businessesToDelete.length },
    });
    return policy;
  }

  const authAdmin = supabaseAuthAdminClient();
  if (!authAdmin) throw new AdminOperationError(AUTH_ADMIN_UNAVAILABLE);

  const client = await sqlClient();
  // Tomma egna företag raderas (cascade tar tenantraderna); övriga medlemskap
  // återkallas. Ordningen spelar roll: domänstädning först, auth-raden sist.
  for (const b of policy.businessesToDelete) {
    await client.query(`delete from public.businesses where id = $1`, [b.id]);
  }
  await client.query(
    `update public.business_memberships set revoked_at = now() where user_id = $1 and revoked_at is null`,
    [userId]
  );
  const { error } = await authAdmin.auth.admin.deleteUser(userId);
  if (error) throw new AdminOperationError(`Auth-kontot kunde inte raderas: ${error.message}`);

  await writeAdminAudit(actor, {
    action: "user_deleted",
    targetType: "user",
    targetId: userId,
    metadata: {
      email,
      businessesDeleted: policy.businessesToDelete.map((b) => b.name || b.id),
      membershipsRevoked: policy.membershipsToRevoke,
    },
  });
  return policy;
}

/* -------------------------------- Företag ---------------------------------- */

export async function disableBusiness(actor: PlatformAdmin, businessId: string, name: string): Promise<void> {
  const already = await businessDisabledAt(businessId);
  if (already) return;
  await setBusinessDisabled(businessId, true, actor.userId);
  await writeAdminAudit(actor, {
    action: "business_disabled",
    targetType: "business",
    targetId: businessId,
    businessId,
    metadata: { name },
  });
}

export async function enableBusiness(actor: PlatformAdmin, businessId: string, name: string): Promise<void> {
  await setBusinessDisabled(businessId, false, actor.userId);
  await writeAdminAudit(actor, {
    action: "business_enabled",
    targetType: "business",
    targetId: businessId,
    businessId,
    metadata: { name },
  });
}

/** Radera företag – endast när policyn tillåter (ingen bevarandepliktig historik). */
export async function deleteBusiness(
  actor: PlatformAdmin,
  businessId: string,
  name: string
): Promise<BusinessDeletionPolicy> {
  const policy = await businessDeletionPolicy(businessId);
  if (!policy.canDelete) {
    throw new AdminOperationError(`Företaget kan inte raderas: ${policy.blockers.join(" ")}`);
  }
  if (!isSupabaseMode()) {
    throw new AdminOperationError(
      "JSON-läget har ett enda lokalt demoföretag – återställ demon från Inställningar i stället för att radera."
    );
  }
  const client = await sqlClient();
  await client.query(`delete from public.businesses where id = $1`, [businessId]);
  await writeAdminAudit(actor, {
    action: "business_deleted",
    targetType: "business",
    targetId: businessId,
    metadata: { name, memberCount: policy.memberCount },
  });
  return policy;
}

/* ------------------------ Samarbetsinbjudan (skicka om) --------------------- */

/**
 * Skicka om en redovisningsinbjudan för ett företag. Återanvänder exakt
 * samma tjänsteflöde som ägaren använder (rotera token + mejla) – admin
 * hittar inte på en egen väg.
 */
export async function resendAccountantInvite(
  actor: PlatformAdmin,
  businessId: string,
  invitationId: string
): Promise<{ mailOk: boolean }> {
  let result: { mailOk: boolean };
  if (!isSupabaseMode()) {
    result = await resendCollaboratorInvite({ invitationId, companyName: db().settings.name });
  } else {
    const row = await invitationRowById(invitationId);
    if (!row || row.businessId !== businessId) {
      throw new AdminOperationError("Inbjudan finns inte för det företaget.");
    }
    putInvitation(row);
    result = await runWithTenant(
      { businessId, userId: actor.userId, access: "write", retry: false },
      async () => resendCollaboratorInvite({ invitationId, companyName: db().settings.name })
    );
  }
  await writeAdminAudit(actor, {
    action: "accountant_invite_resent",
    targetType: "collaboration_invitation",
    targetId: invitationId,
    businessId,
  });
  return result;
}
