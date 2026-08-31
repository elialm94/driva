/**
 * Orchestrering: registry + tenant-DB + (i Supabase) memberships-tabellen.
 */
import { db, save } from "../store";
import { isSupabaseMode } from "../storage/config";
import { activateOptionalFeature } from "../features";
import {
  businessNameById,
  insertMembership,
  invitationRowByTokenHash,
  revokeMembershipRow,
  upsertInvitationRow,
} from "../storage/adapter-supabase";
import type { CollaborationInvitation, CollaborationRole } from "../types";
import { logAudit } from "../accounting/audit";
import {
  acceptInvitation,
  createInvitation,
  hashInviteToken,
  invitationStatus,
  inviteeDisplayName,
  peekInvitation,
  revokeAccess,
  rotateInvitationToken,
} from "./invitations";
import {
  activeMembershipsForBusiness,
  invitationByTokenHash,
  invitationsForBusiness,
  putInvitation,
  touchLastActive,
  upsertUser,
  userById,
} from "./registry";
import { sendCollaborationInviteEmail } from "./mail";
import { isLastActiveToday } from "./registry";
import { roleLabel } from "./permissions";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export async function persistInvitation(inv: CollaborationInvitation): Promise<void> {
  putInvitation(inv);
  try {
    const data = db();
    data.collaborationInvitations ??= [];
    const idx = data.collaborationInvitations.findIndex((i) => i.id === inv.id);
    if (idx >= 0) data.collaborationInvitations[idx] = inv;
    else data.collaborationInvitations.push(inv);
    save();
  } catch {
    // Accept kan ske innan tenantkontext finns – registret + SQL räcker.
  }
  if (isSupabaseMode()) await upsertInvitationRow(inv);
}

export async function inviteCollaborator(input: {
  businessId: string;
  businessName: string;
  email: string;
  role: CollaborationRole;
  invitedByUserId: string;
  invitedByName: string;
}): Promise<{ invitation: CollaborationInvitation; token: string; mailOk: boolean }> {
  const created = createInvitation(input);
  await persistInvitation(created.invitation);
  activateOptionalFeature("collaboration");
  logAudit("anvandare", "samarbete_bjuden", `${input.invitedByName} bjöd in ${input.email} som ${roleLabel(input.role)}.`, {
    targetType: "inbjudan",
    targetId: created.invitation.id,
  });
  const last = db().auditTrail[db().auditTrail.length - 1];
  if (last) {
    last.actorUserId = input.invitedByUserId;
    last.actorRole = "owner";
  }
  save();
  const mail = await sendCollaborationInviteEmail({
    invitation: created.invitation,
    token: created.token,
    companyName: input.businessName,
  });
  return { ...created, mailOk: mail.ok };
}

export async function resendCollaboratorInvite(input: {
  invitationId: string;
  companyName: string;
}): Promise<{ mailOk: boolean }> {
  const rotated = rotateInvitationToken(input.invitationId);
  await persistInvitation(rotated.invitation);
  const mail = await sendCollaborationInviteEmail({
    invitation: rotated.invitation,
    token: rotated.token,
    companyName: input.companyName,
  });
  return { mailOk: mail.ok };
}

export async function lookupInvitation(token: string): Promise<CollaborationInvitation | null> {
  const local = peekInvitation(token);
  if (local) return local;
  if (!isSupabaseMode()) return null;
  const row = await invitationRowByTokenHash(hashInviteToken(token));
  if (!row) return null;
  putInvitation(row);
  return { ...row, status: invitationStatus(row) };
}

export async function acceptCollaboratorInvite(input: {
  token: string;
  userId: string;
  email: string;
  name: string;
}): Promise<{ businessId: string; role: CollaborationRole }> {
  let inv = await lookupInvitation(input.token);
  if (!inv) throw new Error("Inbjudan finns inte eller är ogiltig.");
  upsertUser({ id: input.userId, email: input.email, name: input.name });
  let businessName = inv.invitedByName;
  if (isSupabaseMode()) {
    businessName = (await businessNameById(inv.businessId)) || businessName;
  } else {
    try {
      businessName = db().settings.name;
    } catch {
      /* registret har redan businessName på medlemskapet */
    }
  }
  const accepted = acceptInvitation({
    token: input.token,
    user: { id: input.userId, email: input.email, name: input.name },
    businessName,
  });
  await persistInvitation(accepted.invitation);
  if (isSupabaseMode()) {
    await insertMembership({
      businessId: inv.businessId,
      userId: input.userId,
      role: inv.role,
      invitedByUserId: inv.invitedByUserId,
    });
  }
  try {
    logAudit("anvandare", "samarbete_accepterad", `${input.name} accepterade inbjudan som ${roleLabel(inv.role)}.`, {
      targetType: "medlemskap",
      targetId: input.userId,
    });
    const last = db().auditTrail[db().auditTrail.length - 1];
    if (last) {
      last.actorUserId = input.userId;
      last.actorRole = inv.role;
    }
    save();
  } catch {
    /* audit skrivs när tenantkontext finns */
  }
  return { businessId: inv.businessId, role: inv.role };
}

export async function revokeCollaborator(input: {
  businessId: string;
  targetUserId?: string;
  invitationId?: string;
  revokedByUserId: string;
  revokedByName: string;
}): Promise<{ name: string }> {
  const result = revokeAccess(input);
  if (result.invitation) await persistInvitation(result.invitation);
  // Registerpersoner utan auth-konto (demo-Anna) har inga SQL-rader – uuid-
  // formatet skiljer riktiga Supabase-användare från registrets syntetiska id:n.
  if (result.membership && isSupabaseMode() && isUuid(result.membership.userId)) {
    await revokeMembershipRow(input.businessId, result.membership.userId);
  }
  const name =
    (result.membership && userById(result.membership.userId)?.name) ||
    (result.invitation ? inviteeDisplayName(result.invitation) : "personen");
  logAudit("anvandare", "samarbete_aterkallad", `${input.revokedByName} tog bort ${name}s åtkomst.`, {
    targetType: "medlemskap",
    targetId: result.membership?.userId ?? input.invitationId,
  });
  const last = db().auditTrail[db().auditTrail.length - 1];
  if (last) {
    last.actorUserId = input.revokedByUserId;
    last.actorRole = "owner";
  }
  save();
  return { name };
}

export interface SamarbetaPerson {
  key: string;
  name: string;
  email: string;
  role: CollaborationRole;
  roleLabel: string;
  status: "active" | "pending";
  lastActiveToday: boolean;
  userId?: string;
  invitationId: string;
}

export function listSamarbetaPeople(businessId: string, now = new Date()): SamarbetaPerson[] {
  const people: SamarbetaPerson[] = [];
  const members = activeMembershipsForBusiness(businessId).filter(
    (m): m is typeof m & { role: CollaborationRole } =>
      m.role === "accounting_consultant" || m.role === "auditor"
  );
  for (const m of members) {
    const user = userById(m.userId);
    const inv = invitationsForBusiness(businessId).find((i) => i.acceptedByUserId === m.userId);
    people.push({
      key: `member:${m.userId}`,
      name: user?.name || user?.email || "Konsult",
      email: user?.email ?? "",
      role: m.role,
      roleLabel: roleLabel(m.role),
      status: "active",
      lastActiveToday: isLastActiveToday(m.lastActiveAt, now),
      userId: m.userId,
      invitationId: inv?.id ?? "",
    });
  }
  for (const inv of invitationsForBusiness(businessId)) {
    if (invitationStatus(inv, now) !== "pending") continue;
    if (people.some((p) => p.email === inv.email && p.status === "active")) continue;
    people.push({
      key: `invite:${inv.id}`,
      name: inviteeDisplayName(inv),
      email: inv.email,
      role: inv.role,
      roleLabel: roleLabel(inv.role),
      status: "pending",
      lastActiveToday: false,
      invitationId: inv.id,
    });
  }
  return people;
}

export function markAccountantActive(userId: string, businessId: string): void {
  touchLastActive(userId, businessId);
}

/** Spegla tenant-inbjudningar till registret (JSON-fil / äldre state). */
export function hydrateInvitationsFromTenant(businessId: string): void {
  for (const inv of db().collaborationInvitations ?? []) {
    putInvitation({ ...inv, businessId: inv.businessId || businessId });
  }
}
