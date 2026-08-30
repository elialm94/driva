/**
 * Hantering av admin-teamet. ENDAST super_admin – rollkravet upprätthålls här
 * (servern), aldrig bara i UI:t.
 *
 * Reglerna (spegel av spec + databastriggern):
 *   * admin kan aldrig skapa/inaktivera/ta bort/ändra en super_admin,
 *     inte heller uppgradera sig själv – all teamhantering kräver super_admin.
 *   * super_admin skapas ALDRIG via inbjudan – endast via bootstrap-skriptet
 *     (scripts/platform-bootstrap.ts, se docs/admin.md).
 *   * Den sista aktiva super_admin kan inte tas bort/inaktiveras (vakt i
 *     store-lagret + databastrigger).
 */
import { createHash, randomBytes } from "crypto";
import { uid } from "../ids";
import {
  deletePlatformAdminRow,
  insertPlatformAdmin,
  listPlatformAdmins,
  listPlatformInvitations,
  platformAdminById,
  platformAdminByUserId,
  platformInvitationById,
  platformInvitationByTokenHash,
  putPlatformInvitation,
  updatePlatformAdminRow,
} from "./store";
import { writeAdminAudit } from "./audit";
import {
  PlatformAccessError,
  SUPER_ADMIN,
  type PlatformAdmin,
  type PlatformAdminInvitation,
} from "./types";

export const ADMIN_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export class PlatformAdminError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlatformAdminError";
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPlatformInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function newPlatformInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

function assertSuperAdmin(actor: PlatformAdmin): void {
  if (actor.role !== SUPER_ADMIN || actor.disabledAt) {
    throw new PlatformAccessError("Endast super_admin får hantera admin-teamet.", 403);
  }
}

export type PlatformInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export function platformInvitationStatus(
  inv: PlatformAdminInvitation,
  now = new Date()
): PlatformInvitationStatus {
  if (inv.revokedAt) return "revoked";
  if (inv.acceptedAt) return "accepted";
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

export async function listAdminTeam(): Promise<{
  admins: PlatformAdmin[];
  invitations: (PlatformAdminInvitation & { status: PlatformInvitationStatus })[];
}> {
  const [admins, invitations] = await Promise.all([listPlatformAdmins(), listPlatformInvitations()]);
  return {
    admins,
    invitations: invitations.map((i) => ({ ...i, status: platformInvitationStatus(i) })),
  };
}

/** super_admin bjuder in en ny admin (rollen är alltid admin – aldrig super_admin). */
export async function invitePlatformAdmin(
  actor: PlatformAdmin,
  email: string,
  now = new Date()
): Promise<{ invitation: PlatformAdminInvitation; token: string }> {
  assertSuperAdmin(actor);
  const normalized = normalizeEmail(email);
  if (!normalized.includes("@") || normalized.length < 5) {
    throw new PlatformAdminError("Ange en giltig e-postadress.");
  }
  const admins = await listPlatformAdmins();
  if (admins.some((a) => normalizeEmail(a.email) === normalized && !a.disabledAt)) {
    throw new PlatformAdminError("Adressen tillhör redan en aktiv plattformsadmin.");
  }
  const invitations = await listPlatformInvitations();
  const pending = invitations.find(
    (i) => normalizeEmail(i.email) === normalized && platformInvitationStatus(i, now) === "pending"
  );
  if (pending) {
    throw new PlatformAdminError("En inbjudan till den adressen är redan skickad. Skicka om den i stället.");
  }

  const token = newPlatformInviteToken();
  const invitation: PlatformAdminInvitation = {
    id: uid(),
    email: normalized,
    role: "admin",
    tokenHash: hashPlatformInviteToken(token),
    invitedByUserId: actor.userId,
    invitedByName: actor.name || actor.email,
    expiresAt: new Date(now.getTime() + ADMIN_INVITE_TTL_MS).toISOString(),
    createdAt: now.toISOString(),
  };
  await putPlatformInvitation(invitation);
  await writeAdminAudit(actor, {
    action: "admin_invited",
    targetType: "platform_admin_invitation",
    targetId: invitation.id,
    metadata: { email: normalized },
  });
  return { invitation, token };
}

/** Ny token + förlängd giltighet. Klartexttoken returneras bara för mejlet. */
export async function resendPlatformInvitation(
  actor: PlatformAdmin,
  invitationId: string,
  now = new Date()
): Promise<{ invitation: PlatformAdminInvitation; token: string }> {
  assertSuperAdmin(actor);
  const inv = await platformInvitationById(invitationId);
  if (!inv) throw new PlatformAdminError("Inbjudan finns inte.");
  const status = platformInvitationStatus(inv, now);
  if (status === "accepted") throw new PlatformAdminError("Inbjudan är redan använd.");
  if (status === "revoked") throw new PlatformAdminError("Inbjudan är återkallad.");
  const token = newPlatformInviteToken();
  const updated: PlatformAdminInvitation = {
    ...inv,
    tokenHash: hashPlatformInviteToken(token),
    expiresAt: new Date(now.getTime() + ADMIN_INVITE_TTL_MS).toISOString(),
  };
  await putPlatformInvitation(updated);
  await writeAdminAudit(actor, {
    action: "admin_invite_resent",
    targetType: "platform_admin_invitation",
    targetId: inv.id,
    metadata: { email: inv.email },
  });
  return { invitation: updated, token };
}

export async function revokePlatformInvitation(
  actor: PlatformAdmin,
  invitationId: string,
  now = new Date()
): Promise<void> {
  assertSuperAdmin(actor);
  const inv = await platformInvitationById(invitationId);
  if (!inv) throw new PlatformAdminError("Inbjudan finns inte.");
  if (inv.acceptedAt) throw new PlatformAdminError("Inbjudan är redan använd och kan inte återkallas.");
  await putPlatformInvitation({ ...inv, revokedAt: now.toISOString(), revokedByUserId: actor.userId });
  await writeAdminAudit(actor, {
    action: "admin_invite_revoked",
    targetType: "platform_admin_invitation",
    targetId: inv.id,
    metadata: { email: inv.email },
  });
}

/** Slå upp inbjudan för visning på acceptsidan (utan att röja hashen). */
export async function peekPlatformInvitation(
  token: string,
  now = new Date()
): Promise<(PlatformAdminInvitation & { status: PlatformInvitationStatus }) | null> {
  if (!token) return null;
  const inv = await platformInvitationByTokenHash(hashPlatformInviteToken(token));
  if (!inv) return null;
  return { ...inv, status: platformInvitationStatus(inv, now) };
}

/**
 * Acceptera inbjudan: verifierad inloggad användare vars e-post matchar
 * inbjudans adress → platform_admins-rad med rollen admin. Aldrig super_admin.
 */
export async function acceptPlatformInvitation(input: {
  token: string;
  user: { id: string; email: string; name?: string };
  now?: Date;
}): Promise<PlatformAdmin> {
  const now = input.now ?? new Date();
  const inv = await peekPlatformInvitation(input.token, now);
  if (!inv) throw new PlatformAdminError("Inbjudan finns inte eller är ogiltig.");
  if (inv.status === "revoked") throw new PlatformAdminError("Inbjudan är återkallad.");
  if (inv.status === "accepted") throw new PlatformAdminError("Inbjudan är redan använd.");
  if (inv.status === "expired") throw new PlatformAdminError("Inbjudan har gått ut. Be en super_admin skicka en ny.");
  if (normalizeEmail(input.user.email) !== normalizeEmail(inv.email)) {
    throw new PlatformAdminError("Logga in med den e-postadress som inbjudan skickades till.");
  }
  const existing = await platformAdminByUserId(input.user.id);
  if (existing && !existing.disabledAt) {
    throw new PlatformAdminError("Du är redan plattformsadmin.");
  }

  const acceptedAt = now.toISOString();
  await putPlatformInvitation({ ...inv, acceptedAt, acceptedByUserId: input.user.id });

  let admin: PlatformAdmin;
  if (existing) {
    // Tidigare inaktiverad admin som bjuds in på nytt: återaktivera raden.
    await updatePlatformAdminRow(existing.id, {
      role: "admin",
      disabledAt: null,
      disabledBy: null,
      email: normalizeEmail(input.user.email),
      name: input.user.name ?? existing.name,
    });
    admin = { ...existing, role: "admin", disabledAt: undefined, disabledBy: undefined };
  } else {
    admin = {
      id: uid(),
      userId: input.user.id,
      role: "admin",
      email: normalizeEmail(input.user.email),
      name: input.user.name ?? "",
      createdAt: acceptedAt,
      createdBy: inv.invitedByUserId,
    };
    await insertPlatformAdmin(admin);
  }

  await writeAdminAudit(admin, {
    action: "admin_invite_accepted",
    targetType: "platform_admin",
    targetId: admin.id,
    metadata: { email: admin.email, invitationId: inv.id },
  });
  return admin;
}

/**
 * Inaktivera en admin. super_admin-mål skyddas av sista-super_admin-vakten
 * (store + DB-trigger); en admin-aktör stoppas redan av assertSuperAdmin.
 */
export async function disablePlatformAdmin(actor: PlatformAdmin, targetId: string): Promise<void> {
  assertSuperAdmin(actor);
  const target = await platformAdminById(targetId);
  if (!target) throw new PlatformAdminError("Admin-raden finns inte.");
  if (target.disabledAt) return;
  await updatePlatformAdminRow(targetId, {
    disabledAt: new Date().toISOString(),
    disabledBy: actor.userId,
  });
  await writeAdminAudit(actor, {
    action: "admin_disabled",
    targetType: "platform_admin",
    targetId,
    metadata: { email: target.email, role: target.role },
  });
}

export async function enablePlatformAdmin(actor: PlatformAdmin, targetId: string): Promise<void> {
  assertSuperAdmin(actor);
  const target = await platformAdminById(targetId);
  if (!target) throw new PlatformAdminError("Admin-raden finns inte.");
  if (!target.disabledAt) return;
  await updatePlatformAdminRow(targetId, { disabledAt: null, disabledBy: null });
  await writeAdminAudit(actor, {
    action: "admin_enabled",
    targetType: "platform_admin",
    targetId,
    metadata: { email: target.email, role: target.role },
  });
}

/** Ta bort en admin permanent. Sista aktiva super_admin kan aldrig tas bort. */
export async function removePlatformAdmin(actor: PlatformAdmin, targetId: string): Promise<void> {
  assertSuperAdmin(actor);
  const target = await platformAdminById(targetId);
  if (!target) throw new PlatformAdminError("Admin-raden finns inte.");
  await deletePlatformAdminRow(targetId);
  await writeAdminAudit(actor, {
    action: "admin_removed",
    targetType: "platform_admin",
    targetId,
    metadata: { email: target.email, role: target.role },
  });
}
