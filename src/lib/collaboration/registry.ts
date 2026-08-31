/**
 * Tvär-företagsregister för medlemskap och inbjudningar.
 *
 * I JSON-/testläge: en in-memory (ev. .data/collaboration.json) källa.
 * I Supabase: speglas mot business_memberships + collaboration_invitations.
 *
 * Tenant-DB:n (db()) äger fortfarande inbjudningar och kundunderlag för
 * det aktiva företaget – registret är uppslaget "vilka företag hör jag till?".
 */
import fs from "fs";
import path from "path";
import type { BusinessRole, CollaborationInvitation, CollaborationRole, ID } from "../types";

export interface CollaborationUser {
  id: ID;
  email: string;
  name: string;
}

export interface CollaborationMembership {
  businessId: ID;
  businessName: string;
  userId: ID;
  role: BusinessRole;
  invitedByUserId?: ID;
  acceptedAt?: string;
  revokedAt?: string;
  lastActiveAt?: string;
  createdAt: string;
}

export interface CollaborationRegistry {
  users: CollaborationUser[];
  memberships: CollaborationMembership[];
  invitations: CollaborationInvitation[];
}

const EMPTY: CollaborationRegistry = { users: [], memberships: [], invitations: [] };

const onServerless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const DATA_FILE = onServerless
  ? path.join("/tmp", "driva-collaboration.json")
  : path.join(process.cwd(), ".data", "collaboration.json");

type GlobalWithCollab = typeof globalThis & { __drivaCollab?: CollaborationRegistry };
const g = globalThis as GlobalWithCollab;

function persist(data: CollaborationRegistry) {
  if (process.env.DRIVA_TEST === "1") return;
  try {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
    const tmp = DATA_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1), "utf8");
    fs.renameSync(tmp, DATA_FILE);
  } catch {
    // Read-only FS: in-memory räcker.
  }
}

function loadFromDisk(): CollaborationRegistry {
  if (process.env.DRIVA_TEST === "1") return { users: [], memberships: [], invitations: [] };
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf8")) as CollaborationRegistry;
    }
  } catch {
    /* tomt */
  }
  return { users: [], memberships: [], invitations: [] };
}

export function collaborationRegistry(): CollaborationRegistry {
  if (!g.__drivaCollab) g.__drivaCollab = loadFromDisk();
  return g.__drivaCollab;
}

export function replaceCollaborationRegistry(data: CollaborationRegistry): void {
  g.__drivaCollab = {
    users: [...data.users],
    memberships: [...data.memberships],
    invitations: [...data.invitations],
  };
}

export function resetCollaborationRegistry(): void {
  g.__drivaCollab = { users: [], memberships: [], invitations: [] };
  persist(g.__drivaCollab);
}

function commit(): void {
  persist(collaborationRegistry());
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function upsertUser(user: CollaborationUser): CollaborationUser {
  const reg = collaborationRegistry();
  const email = normalizeEmail(user.email);
  const existing = reg.users.find((u) => u.id === user.id || normalizeEmail(u.email) === email);
  if (existing) {
    existing.email = email;
    if (user.name) existing.name = user.name;
    commit();
    return existing;
  }
  const created = { ...user, email };
  reg.users.push(created);
  commit();
  return created;
}

export function userById(id: string): CollaborationUser | undefined {
  return collaborationRegistry().users.find((u) => u.id === id);
}

export function userByEmail(email: string): CollaborationUser | undefined {
  const key = normalizeEmail(email);
  return collaborationRegistry().users.find((u) => normalizeEmail(u.email) === key);
}

export function activeMembershipsForUser(userId: string): CollaborationMembership[] {
  return collaborationRegistry().memberships.filter((m) => m.userId === userId && !m.revokedAt);
}

export function activeMembershipsForBusiness(businessId: string): CollaborationMembership[] {
  return collaborationRegistry().memberships.filter((m) => m.businessId === businessId && !m.revokedAt);
}

export function membershipFor(userId: string, businessId: string): CollaborationMembership | undefined {
  return collaborationRegistry().memberships.find((m) => m.userId === userId && m.businessId === businessId);
}

export function activeMembershipFor(userId: string, businessId: string): CollaborationMembership | undefined {
  const m = membershipFor(userId, businessId);
  return m && !m.revokedAt ? m : undefined;
}

export function putMembership(row: CollaborationMembership): CollaborationMembership {
  const reg = collaborationRegistry();
  const idx = reg.memberships.findIndex((m) => m.userId === row.userId && m.businessId === row.businessId);
  if (idx >= 0) reg.memberships[idx] = row;
  else reg.memberships.push(row);
  commit();
  return row;
}

export function restoreMembership(
  userId: string,
  businessId: string,
  at = new Date().toISOString(),
): CollaborationMembership | undefined {
  const m = membershipFor(userId, businessId);
  if (!m) return undefined;
  if (!m.revokedAt) return m;
  const restored = { ...m, lastActiveAt: at };
  delete restored.revokedAt;
  return putMembership(restored);
}

export function accountingMembershipsForBusiness(businessId: string): CollaborationMembership[] {
  return collaborationRegistry().memberships.filter(
    (m) => m.businessId === businessId && (m.role === "accounting_consultant" || m.role === "auditor"),
  );
}

export function revokeMembership(userId: string, businessId: string, at = new Date().toISOString()): CollaborationMembership | undefined {
  const m = membershipFor(userId, businessId);
  if (!m || m.revokedAt) return m;
  m.revokedAt = at;
  commit();
  return m;
}

export function touchLastActive(userId: string, businessId: string, at = new Date().toISOString()): void {
  const m = activeMembershipFor(userId, businessId);
  if (!m) return;
  m.lastActiveAt = at;
  commit();
}

export function putInvitation(inv: CollaborationInvitation): CollaborationInvitation {
  const reg = collaborationRegistry();
  const idx = reg.invitations.findIndex((i) => i.id === inv.id);
  if (idx >= 0) reg.invitations[idx] = inv;
  else reg.invitations.push(inv);
  commit();
  return inv;
}

export function invitationById(id: string): CollaborationInvitation | undefined {
  return collaborationRegistry().invitations.find((i) => i.id === id);
}

export function invitationByTokenHash(tokenHash: string): CollaborationInvitation | undefined {
  return collaborationRegistry().invitations.find((i) => i.tokenHash === tokenHash);
}

export function invitationsForBusiness(businessId: string): CollaborationInvitation[] {
  return collaborationRegistry().invitations.filter((i) => i.businessId === businessId);
}

export function pendingInviteForEmail(businessId: string, email: string): CollaborationInvitation | undefined {
  const key = normalizeEmail(email);
  return collaborationRegistry().invitations.find(
    (i) =>
      i.businessId === businessId &&
      normalizeEmail(i.email) === key &&
      i.status === "pending" &&
      !i.revokedAt &&
      !i.acceptedAt
  );
}

export function ownerMemberships(userId: string): CollaborationMembership[] {
  return activeMembershipsForUser(userId).filter(
    (m) => m.role === "owner" || m.role === "admin" || m.role === "member"
  );
}

export function accountingMemberships(userId: string): CollaborationMembership[] {
  return activeMembershipsForUser(userId).filter(
    (m) => m.role === "accounting_consultant" || m.role === "auditor"
  );
}

export function isLastActiveToday(iso: string | undefined, now = new Date()): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

export function displayNameForRole(role: CollaborationRole): string {
  return role === "auditor" ? "revisor" : "redovisningskonsult";
}
