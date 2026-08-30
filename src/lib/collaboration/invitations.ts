/**
 * Inbjudan / accept / revoke. Token hashas (SHA-256) – klartext returneras
 * bara vid utskick. En gång, tidsbegränsad, återkallbar.
 */
import { createHash, randomBytes } from "crypto";
import type { CollaborationInvitation, CollaborationRole, ID } from "../types";
import { uid } from "../ids";
import {
  activeMembershipFor,
  invitationById,
  invitationByTokenHash,
  normalizeEmail,
  pendingInviteForEmail,
  putInvitation,
  putMembership,
  revokeMembership,
  upsertUser,
  userByEmail,
  userById,
  type CollaborationMembership,
  type CollaborationUser,
} from "./registry";
import { isOwnerRole } from "./permissions";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export class CollaborationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CollaborationError";
  }
}

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function newInviteToken(): string {
  return randomBytes(32).toString("base64url");
}

export function invitationStatus(inv: CollaborationInvitation, now = new Date()): CollaborationInvitation["status"] {
  if (inv.revokedAt) return "revoked";
  if (inv.acceptedAt) return "accepted";
  if (new Date(inv.expiresAt).getTime() <= now.getTime()) return "expired";
  return "pending";
}

export function createInvitation(input: {
  businessId: ID;
  businessName: string;
  email: string;
  role: CollaborationRole;
  invitedByUserId: ID;
  invitedByName: string;
  now?: Date;
}): { invitation: CollaborationInvitation; token: string } {
  const email = normalizeEmail(input.email);
  if (!email.includes("@") || email.length < 5) {
    throw new CollaborationError("Ange en giltig e-postadress.");
  }
  if (input.role !== "accounting_consultant" && input.role !== "auditor") {
    throw new CollaborationError("Välj rollen redovisningskonsult eller revisor.");
  }
  const existingUser = userByEmail(email);
  if (existingUser) {
    const existing = activeMembershipFor(existingUser.id, input.businessId);
    if (existing) {
      throw new CollaborationError(`${existingUser.name || email} har redan åtkomst till företaget.`);
    }
  }
  const pending = pendingInviteForEmail(input.businessId, email);
  if (pending && invitationStatus(pending, input.now) === "pending") {
    throw new CollaborationError("En inbjudan till den adressen är redan skickad.");
  }

  const token = newInviteToken();
  const now = input.now ?? new Date();
  const invitation: CollaborationInvitation = {
    id: uid(),
    businessId: input.businessId,
    email,
    role: input.role,
    invitedByUserId: input.invitedByUserId,
    invitedByName: input.invitedByName,
    tokenHash: hashInviteToken(token),
    expiresAt: new Date(now.getTime() + INVITE_TTL_MS).toISOString(),
    status: "pending",
    createdAt: now.toISOString(),
  };
  putInvitation(invitation);
  return { invitation, token };
}

/** Ny token + förlängd giltighet. Klartext returneras bara för mejlet. */
export function rotateInvitationToken(
  invitationId: string,
  now = new Date()
): { invitation: CollaborationInvitation; token: string } {
  const inv = invitationById(invitationId);
  if (!inv || invitationStatus(inv, now) !== "pending") {
    throw new CollaborationError("Inbjudan går inte att skicka igen.");
  }
  const token = newInviteToken();
  inv.tokenHash = hashInviteToken(token);
  inv.expiresAt = new Date(now.getTime() + INVITE_TTL_MS).toISOString();
  inv.status = "pending";
  putInvitation(inv);
  return { invitation: inv, token };
}

export function peekInvitation(token: string, now = new Date()): CollaborationInvitation | null {
  if (!token) return null;
  const inv = invitationByTokenHash(hashInviteToken(token));
  if (!inv) return null;
  return { ...inv, status: invitationStatus(inv, now) };
}

export function acceptInvitation(input: {
  token: string;
  user: CollaborationUser;
  businessName: string;
  now?: Date;
}): { invitation: CollaborationInvitation; membership: CollaborationMembership } {
  const now = input.now ?? new Date();
  const inv = peekInvitation(input.token, now);
  if (!inv) throw new CollaborationError("Inbjudan finns inte eller är ogiltig.");
  if (inv.status === "revoked") throw new CollaborationError("Inbjudan är återkallad.");
  if (inv.status === "accepted") throw new CollaborationError("Inbjudan är redan använd.");
  if (inv.status === "expired") throw new CollaborationError("Inbjudan har gått ut. Be ägaren skicka en ny.");
  if (normalizeEmail(input.user.email) !== normalizeEmail(inv.email)) {
    throw new CollaborationError("Logga in med den e-postadress inbjudan skickades till.");
  }

  const existing = activeMembershipFor(input.user.id, inv.businessId);
  if (existing) {
    throw new CollaborationError("Du har redan åtkomst till det här företaget.");
  }

  const user = upsertUser(input.user);
  const acceptedAt = now.toISOString();
  const accepted: CollaborationInvitation = {
    ...inv,
    status: "accepted",
    acceptedAt,
    acceptedByUserId: user.id,
  };
  putInvitation(accepted);

  const membership = putMembership({
    businessId: inv.businessId,
    businessName: input.businessName,
    userId: user.id,
    role: inv.role,
    invitedByUserId: inv.invitedByUserId,
    acceptedAt,
    lastActiveAt: acceptedAt,
    createdAt: acceptedAt,
  });
  return { invitation: accepted, membership };
}

export function revokeAccess(input: {
  businessId: ID;
  targetUserId?: ID;
  invitationId?: ID;
  revokedByUserId: ID;
  now?: Date;
}): { membership?: CollaborationMembership; invitation?: CollaborationInvitation } {
  const now = (input.now ?? new Date()).toISOString();
  let membership: CollaborationMembership | undefined;
  let invitation: CollaborationInvitation | undefined;

  if (input.targetUserId) {
    const current = activeMembershipFor(input.targetUserId, input.businessId);
    if (!current) throw new CollaborationError("Personen har inte åtkomst.");
    if (isOwnerRole(current.role)) {
      throw new CollaborationError("Ägarens åtkomst kan inte tas bort här.");
    }
    membership = revokeMembership(input.targetUserId, input.businessId, now);
  }

  if (input.invitationId) {
    const inv = invitationById(input.invitationId);
    if (!inv || inv.businessId !== input.businessId) {
      throw new CollaborationError("Inbjudan finns inte.");
    }
    invitation = {
      ...inv,
      status: inv.acceptedAt ? inv.status : "revoked",
      revokedAt: now,
      revokedByUserId: input.revokedByUserId,
    };
    putInvitation(invitation);
    if (inv.acceptedByUserId && !input.targetUserId) {
      membership = revokeMembership(inv.acceptedByUserId, input.businessId, now) ?? membership;
    }
  }

  return { membership, invitation };
}

export function inviteeDisplayName(inv: CollaborationInvitation): string {
  if (inv.acceptedByUserId) {
    const u = userById(inv.acceptedByUserId);
    if (u?.name) return u.name;
  }
  const local = inv.email.split("@")[0] ?? inv.email;
  return local
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join(" ") || inv.email;
}
