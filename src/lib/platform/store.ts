/**
 * Lagringsfasad för plattformsdatat (Driva Admin).
 *
 * Två lägen, samma kontrakt (jfr src/lib/store.ts för tenantdata):
 *
 *   * SUPABASE: riktiga tabeller (platform_admins, support_tickets, …) via
 *     samma SQL-klient som tenantadaptern (inkl. PGlite-override i tester).
 *     Frågorna körs som anslutningsanvändaren – plattformsdata är globalt
 *     och auktoriseras server-side i src/lib/platform/auth.ts före varje
 *     anrop (samma mönster som membershipsForUser i adaptern). RLS på
 *     tabellerna skyddar Data API-vägen (authenticated/anon ser ingenting).
 *
 *   * JSON (endast utveckling/tester): .data/platform.json via registry.ts.
 *
 * Sista-super-admin-skyddet finns i BÅDA lägena: databastriggern
 * app.platform_admins_guard i Supabase, och motsvarande vakt här i JSON-läget.
 */
import { isSupabaseMode } from "../storage/config";
import { sqlClient } from "../storage/adapter-supabase";
import type { SqlRow } from "../storage/executor";
import { platformRegistry, commitPlatformRegistry } from "./registry";
import type {
  AdminAuditEntry,
  EmailEvent,
  PlatformAdmin,
  PlatformAdminInvitation,
  SupportSession,
  SupportTicket,
  SupportTicketStatus,
} from "./types";

export class LastSuperAdminError extends Error {
  constructor() {
    super("Den sista aktiva super_admin kan inte tas bort eller inaktiveras. Utse en annan super_admin först.");
    this.name = "LastSuperAdminError";
  }
}

function iso(v: unknown): string {
  if (!v) return new Date(0).toISOString();
  return new Date(v as string).toISOString();
}

function isoOrUndef(v: unknown): string | undefined {
  return v ? new Date(v as string).toISOString() : undefined;
}

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function strOrUndef(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}

/* ------------------------------ platform_admins ----------------------------- */

function adminFromRow(r: SqlRow): PlatformAdmin {
  return {
    id: str(r.id),
    userId: str(r.user_id),
    role: r.role as PlatformAdmin["role"],
    email: str(r.email),
    name: str(r.name),
    createdAt: iso(r.created_at),
    createdBy: strOrUndef(r.created_by),
    disabledAt: isoOrUndef(r.disabled_at),
    disabledBy: strOrUndef(r.disabled_by),
  };
}

export async function listPlatformAdmins(): Promise<PlatformAdmin[]> {
  if (!isSupabaseMode()) {
    return [...platformRegistry().admins].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admins order by created_at, id`);
  return rows.map(adminFromRow);
}

export async function platformAdminByUserId(userId: string): Promise<PlatformAdmin | null> {
  if (!userId) return null;
  if (!isSupabaseMode()) {
    return platformRegistry().admins.find((a) => a.userId === userId) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admins where user_id = $1 limit 1`, [userId]);
  return rows[0] ? adminFromRow(rows[0]) : null;
}

export async function platformAdminById(id: string): Promise<PlatformAdmin | null> {
  if (!isSupabaseMode()) {
    return platformRegistry().admins.find((a) => a.id === id) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admins where id = $1 limit 1`, [id]);
  return rows[0] ? adminFromRow(rows[0]) : null;
}

export async function insertPlatformAdmin(admin: PlatformAdmin): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    if (reg.admins.some((a) => a.userId === admin.userId)) {
      throw new Error("Användaren är redan plattformsadmin.");
    }
    reg.admins.push({ ...admin });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.platform_admins (id, user_id, role, email, name, created_at, created_by, disabled_at, disabled_by)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      admin.id,
      admin.userId,
      admin.role,
      admin.email,
      admin.name,
      admin.createdAt,
      admin.createdBy ?? null,
      admin.disabledAt ?? null,
      admin.disabledBy ?? null,
    ]
  );
}

/** Vakt för JSON-läget – speglar databastriggern app.platform_admins_guard. */
function assertNotLastSuperAdmin(reg: { admins: PlatformAdmin[] }, target: PlatformAdmin, next: PlatformAdmin | null): void {
  const wasActiveSuper = target.role === "super_admin" && !target.disabledAt;
  if (!wasActiveSuper) return;
  const deactivates = next === null || Boolean(next.disabledAt) || next.role !== "super_admin";
  if (!deactivates) return;
  const remaining = reg.admins.filter(
    (a) => a.id !== target.id && a.role === "super_admin" && !a.disabledAt
  );
  if (remaining.length === 0) throw new LastSuperAdminError();
}

export interface PlatformAdminPatch {
  role?: PlatformAdmin["role"];
  disabledAt?: string | null;
  disabledBy?: string | null;
  email?: string;
  name?: string;
}

export async function updatePlatformAdminRow(id: string, patch: PlatformAdminPatch): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    const current = reg.admins.find((a) => a.id === id);
    if (!current) throw new Error("Admin-raden finns inte.");
    const next: PlatformAdmin = {
      ...current,
      ...(patch.role !== undefined ? { role: patch.role } : null),
      ...(patch.email !== undefined ? { email: patch.email } : null),
      ...(patch.name !== undefined ? { name: patch.name } : null),
    };
    if (patch.disabledAt !== undefined) next.disabledAt = patch.disabledAt ?? undefined;
    if (patch.disabledBy !== undefined) next.disabledBy = patch.disabledBy ?? undefined;
    assertNotLastSuperAdmin(reg, current, next);
    Object.assign(current, next);
    if (patch.disabledAt === null) delete current.disabledAt;
    if (patch.disabledBy === null) delete current.disabledBy;
    commitPlatformRegistry();
    return;
  }
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const push = (sql: string, value: string | null) => {
    params.push(value);
    sets.push(`${sql} = $${params.length}`);
  };
  if (patch.role !== undefined) push("role", patch.role);
  if (patch.disabledAt !== undefined) push("disabled_at", patch.disabledAt);
  if (patch.disabledBy !== undefined) push("disabled_by", patch.disabledBy);
  if (patch.email !== undefined) push("email", patch.email);
  if (patch.name !== undefined) push("name", patch.name);
  if (sets.length === 0) return;
  params.push(id);
  const client = await sqlClient();
  try {
    await client.query(`update public.platform_admins set ${sets.join(", ")} where id = $${params.length}`, params);
  } catch (e) {
    throw translateGuardError(e);
  }
}

export async function deletePlatformAdminRow(id: string): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    const current = reg.admins.find((a) => a.id === id);
    if (!current) return;
    assertNotLastSuperAdmin(reg, current, null);
    reg.admins = reg.admins.filter((a) => a.id !== id);
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  try {
    await client.query(`delete from public.platform_admins where id = $1`, [id]);
  } catch (e) {
    throw translateGuardError(e);
  }
}

function translateGuardError(e: unknown): Error {
  const message = e instanceof Error ? e.message : String(e);
  if (message.includes("sista aktiva super_admin")) return new LastSuperAdminError();
  return e instanceof Error ? e : new Error(message);
}

/* ------------------------- platform_admin_invitations ----------------------- */

function invitationFromRow(r: SqlRow): PlatformAdminInvitation {
  return {
    id: str(r.id),
    email: str(r.email),
    role: "admin",
    tokenHash: str(r.token_hash),
    invitedByUserId: str(r.invited_by_user_id),
    invitedByName: str(r.invited_by_name),
    expiresAt: iso(r.expires_at),
    acceptedAt: isoOrUndef(r.accepted_at),
    acceptedByUserId: strOrUndef(r.accepted_by_user_id),
    revokedAt: isoOrUndef(r.revoked_at),
    revokedByUserId: strOrUndef(r.revoked_by_user_id),
    createdAt: iso(r.created_at),
  };
}

export async function putPlatformInvitation(inv: PlatformAdminInvitation): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    const idx = reg.invitations.findIndex((i) => i.id === inv.id);
    if (idx >= 0) reg.invitations[idx] = { ...inv };
    else reg.invitations.push({ ...inv });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.platform_admin_invitations (
       id, email, role, token_hash, invited_by_user_id, invited_by_name,
       expires_at, accepted_at, accepted_by_user_id, revoked_at, revoked_by_user_id, created_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     on conflict (id) do update set
       email = excluded.email,
       token_hash = excluded.token_hash,
       expires_at = excluded.expires_at,
       accepted_at = excluded.accepted_at,
       accepted_by_user_id = excluded.accepted_by_user_id,
       revoked_at = excluded.revoked_at,
       revoked_by_user_id = excluded.revoked_by_user_id`,
    [
      inv.id,
      inv.email,
      inv.role,
      inv.tokenHash,
      inv.invitedByUserId,
      inv.invitedByName,
      inv.expiresAt,
      inv.acceptedAt ?? null,
      inv.acceptedByUserId ?? null,
      inv.revokedAt ?? null,
      inv.revokedByUserId ?? null,
      inv.createdAt,
    ]
  );
}

export async function platformInvitationByTokenHash(tokenHash: string): Promise<PlatformAdminInvitation | null> {
  if (!isSupabaseMode()) {
    return platformRegistry().invitations.find((i) => i.tokenHash === tokenHash) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admin_invitations where token_hash = $1 limit 1`, [
    tokenHash,
  ]);
  return rows[0] ? invitationFromRow(rows[0]) : null;
}

export async function platformInvitationById(id: string): Promise<PlatformAdminInvitation | null> {
  if (!isSupabaseMode()) {
    return platformRegistry().invitations.find((i) => i.id === id) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admin_invitations where id = $1 limit 1`, [id]);
  return rows[0] ? invitationFromRow(rows[0]) : null;
}

export async function listPlatformInvitations(): Promise<PlatformAdminInvitation[]> {
  if (!isSupabaseMode()) {
    return [...platformRegistry().invitations].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.platform_admin_invitations order by created_at desc`);
  return rows.map(invitationFromRow);
}

/* ------------------------------ support_tickets ----------------------------- */

function ticketFromRow(r: SqlRow): SupportTicket {
  return {
    id: str(r.id),
    businessId: strOrUndef(r.business_id),
    userId: strOrUndef(r.user_id),
    userEmail: str(r.user_email),
    userName: str(r.user_name),
    businessName: str(r.business_name),
    subject: str(r.subject),
    message: str(r.message),
    status: r.status as SupportTicket["status"],
    priority: r.priority as SupportTicket["priority"],
    assignedAdminId: strOrUndef(r.assigned_admin_id),
    route: str(r.route),
    userAgent: str(r.user_agent),
    appVersion: str(r.app_version),
    attachmentName: strOrUndef(r.attachment_name),
    attachmentDataUrl: strOrUndef(r.attachment_data_url),
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export async function insertSupportTicket(t: SupportTicket): Promise<void> {
  if (!isSupabaseMode()) {
    platformRegistry().tickets.push({ ...t });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.support_tickets (
       id, business_id, user_id, user_email, user_name, business_name, subject, message,
       status, priority, assigned_admin_id, route, user_agent, app_version,
       attachment_name, attachment_data_url, created_at, updated_at
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
    [
      t.id,
      t.businessId ?? null,
      t.userId ?? null,
      t.userEmail,
      t.userName,
      t.businessName,
      t.subject,
      t.message,
      t.status,
      t.priority,
      t.assignedAdminId ?? null,
      t.route,
      t.userAgent,
      t.appVersion,
      t.attachmentName ?? null,
      t.attachmentDataUrl ?? null,
      t.createdAt,
      t.updatedAt,
    ]
  );
}

export interface SupportTicketPatch {
  status?: SupportTicket["status"];
  priority?: SupportTicket["priority"];
  assignedAdminId?: string | null;
  updatedAt: string;
}

export async function updateSupportTicketRow(id: string, patch: SupportTicketPatch): Promise<void> {
  if (!isSupabaseMode()) {
    const t = platformRegistry().tickets.find((x) => x.id === id);
    if (!t) throw new Error("Ärendet finns inte.");
    if (patch.status !== undefined) t.status = patch.status;
    if (patch.priority !== undefined) t.priority = patch.priority;
    if (patch.assignedAdminId !== undefined) t.assignedAdminId = patch.assignedAdminId ?? undefined;
    t.updatedAt = patch.updatedAt;
    commitPlatformRegistry();
    return;
  }
  const sets: string[] = [];
  const params: (string | null)[] = [];
  const push = (col: string, value: string | null) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status !== undefined) push("status", patch.status);
  if (patch.priority !== undefined) push("priority", patch.priority);
  if (patch.assignedAdminId !== undefined) push("assigned_admin_id", patch.assignedAdminId);
  push("updated_at", patch.updatedAt);
  params.push(id);
  const client = await sqlClient();
  await client.query(`update public.support_tickets set ${sets.join(", ")} where id = $${params.length}`, params);
}

export async function supportTicketById(id: string): Promise<SupportTicket | null> {
  if (!isSupabaseMode()) {
    return platformRegistry().tickets.find((t) => t.id === id) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.support_tickets where id = $1 limit 1`, [id]);
  return rows[0] ? ticketFromRow(rows[0]) : null;
}

export interface TicketListFilter {
  statuses?: SupportTicketStatus[];
  businessId?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export async function listSupportTickets(filter: TicketListFilter = {}): Promise<SupportTicket[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 200);
  const offset = Math.max(filter.offset ?? 0, 0);
  if (!isSupabaseMode()) {
    let items = [...platformRegistry().tickets];
    if (filter.statuses?.length) items = items.filter((t) => filter.statuses!.includes(t.status));
    if (filter.businessId) items = items.filter((t) => t.businessId === filter.businessId);
    if (filter.q) {
      const q = filter.q.toLowerCase();
      items = items.filter(
        (t) =>
          t.subject.toLowerCase().includes(q) ||
          t.userEmail.toLowerCase().includes(q) ||
          t.businessName.toLowerCase().includes(q)
      );
    }
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit);
  }
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.statuses?.length) {
    params.push(filter.statuses.join(","));
    where.push(`status = any(string_to_array($${params.length}, ','))`);
  }
  if (filter.businessId) {
    params.push(filter.businessId);
    where.push(`business_id = $${params.length}::uuid`);
  }
  if (filter.q) {
    params.push(`%${filter.q}%`);
    where.push(
      `(subject ilike $${params.length} or user_email ilike $${params.length} or business_name ilike $${params.length})`
    );
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;
  const client = await sqlClient();
  const rows = await client.query(
    `select * from public.support_tickets
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc
      limit $${limitIdx} offset $${offsetIdx}`,
    params
  );
  return rows.map(ticketFromRow);
}

export async function countSupportTicketsByStatus(): Promise<Record<SupportTicketStatus, number>> {
  const counts: Record<SupportTicketStatus, number> = {
    open: 0,
    in_progress: 0,
    waiting_for_customer: 0,
    resolved: 0,
  };
  if (!isSupabaseMode()) {
    for (const t of platformRegistry().tickets) counts[t.status] += 1;
    return counts;
  }
  const client = await sqlClient();
  const rows = await client.query(`select status, count(*)::int as n from public.support_tickets group by status`);
  for (const r of rows) {
    const status = String(r.status) as SupportTicketStatus;
    if (status in counts) counts[status] = Number(r.n);
  }
  return counts;
}

/* ------------------------------ support_sessions ---------------------------- */

function sessionFromRow(r: SqlRow): SupportSession {
  return {
    id: str(r.id),
    adminUserId: str(r.admin_user_id),
    businessId: str(r.business_id),
    reason: str(r.reason),
    ticketId: strOrUndef(r.ticket_id),
    startedAt: iso(r.started_at),
    expiresAt: iso(r.expires_at),
    endedAt: isoOrUndef(r.ended_at),
  };
}

export async function insertSupportSession(s: SupportSession): Promise<void> {
  if (!isSupabaseMode()) {
    platformRegistry().sessions.push({ ...s });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.support_sessions (id, admin_user_id, business_id, reason, ticket_id, started_at, expires_at, ended_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [s.id, s.adminUserId, s.businessId, s.reason, s.ticketId ?? null, s.startedAt, s.expiresAt, s.endedAt ?? null]
  );
}

export async function supportSessionById(id: string): Promise<SupportSession | null> {
  if (!id) return null;
  if (!isSupabaseMode()) {
    return platformRegistry().sessions.find((s) => s.id === id) ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select * from public.support_sessions where id = $1 limit 1`, [id]);
  return rows[0] ? sessionFromRow(rows[0]) : null;
}

export async function endSupportSessionRow(id: string, endedAt: string): Promise<void> {
  if (!isSupabaseMode()) {
    const s = platformRegistry().sessions.find((x) => x.id === id);
    if (s && !s.endedAt) s.endedAt = endedAt;
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(`update public.support_sessions set ended_at = $2 where id = $1 and ended_at is null`, [
    id,
    endedAt,
  ]);
}

export async function listSupportSessions(filter: {
  adminUserId?: string;
  businessId?: string;
  limit?: number;
} = {}): Promise<SupportSession[]> {
  const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
  if (!isSupabaseMode()) {
    let items = [...platformRegistry().sessions];
    if (filter.adminUserId) items = items.filter((s) => s.adminUserId === filter.adminUserId);
    if (filter.businessId) items = items.filter((s) => s.businessId === filter.businessId);
    return items.sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, limit);
  }
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.adminUserId) {
    params.push(filter.adminUserId);
    where.push(`admin_user_id = $${params.length}::uuid`);
  }
  if (filter.businessId) {
    params.push(filter.businessId);
    where.push(`business_id = $${params.length}::uuid`);
  }
  params.push(limit);
  const client = await sqlClient();
  const rows = await client.query(
    `select * from public.support_sessions
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by started_at desc limit $${params.length}`,
    params
  );
  return rows.map(sessionFromRow);
}

/* ------------------------------ admin_audit_log ----------------------------- */

function auditFromRow(r: SqlRow): AdminAuditEntry {
  let metadata: Record<string, unknown> = {};
  if (r.metadata && typeof r.metadata === "object") metadata = r.metadata as Record<string, unknown>;
  else if (typeof r.metadata === "string") {
    try {
      metadata = JSON.parse(r.metadata) as Record<string, unknown>;
    } catch {
      metadata = {};
    }
  }
  return {
    id: str(r.id),
    adminUserId: str(r.admin_user_id),
    adminEmail: str(r.admin_email),
    adminRole: str(r.admin_role),
    action: str(r.action),
    targetType: strOrUndef(r.target_type),
    targetId: strOrUndef(r.target_id),
    businessId: strOrUndef(r.business_id),
    metadata,
    createdAt: iso(r.created_at),
  };
}

export async function insertAdminAuditRow(entry: AdminAuditEntry): Promise<void> {
  if (!isSupabaseMode()) {
    platformRegistry().auditLog.push({ ...entry });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.admin_audit_log (id, admin_user_id, admin_email, admin_role, action, target_type, target_id, business_id, metadata, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
    [
      entry.id,
      entry.adminUserId,
      entry.adminEmail,
      entry.adminRole,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      entry.businessId ?? null,
      JSON.stringify(entry.metadata ?? {}),
      entry.createdAt,
    ]
  );
}

export async function listAdminAudit(filter: {
  limit?: number;
  offset?: number;
  businessId?: string;
  targetType?: string;
  targetId?: string;
} = {}): Promise<AdminAuditEntry[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  const offset = Math.max(filter.offset ?? 0, 0);
  if (!isSupabaseMode()) {
    let items = [...platformRegistry().auditLog];
    if (filter.businessId) items = items.filter((e) => e.businessId === filter.businessId);
    if (filter.targetType) items = items.filter((e) => e.targetType === filter.targetType);
    if (filter.targetId) items = items.filter((e) => e.targetId === filter.targetId);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(offset, offset + limit);
  }
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.businessId) {
    params.push(filter.businessId);
    where.push(`business_id = $${params.length}::uuid`);
  }
  if (filter.targetType) {
    params.push(filter.targetType);
    where.push(`target_type = $${params.length}`);
  }
  if (filter.targetId) {
    params.push(filter.targetId);
    where.push(`target_id = $${params.length}`);
  }
  params.push(limit);
  const limitIdx = params.length;
  params.push(offset);
  const client = await sqlClient();
  const rows = await client.query(
    `select * from public.admin_audit_log
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc limit $${limitIdx} offset $${params.length}`,
    params
  );
  return rows.map(auditFromRow);
}

/* -------------------------------- email_events ------------------------------ */

function emailEventFromRow(r: SqlRow): EmailEvent {
  return {
    id: str(r.id),
    businessId: strOrUndef(r.business_id),
    kind: str(r.kind),
    documentId: strOrUndef(r.document_id),
    toEmail: str(r.to_email),
    status: r.status as EmailEvent["status"],
    error: strOrUndef(r.error),
    providerMessageId: strOrUndef(r.provider_message_id),
    mode: (r.mode as EmailEvent["mode"]) ?? "live",
    createdAt: iso(r.created_at),
  };
}

export async function insertEmailEvent(e: EmailEvent): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    reg.emailEvents.push({ ...e });
    // Operativ logg, inte historik: håll dev-filen rimligt stor.
    if (reg.emailEvents.length > 2000) reg.emailEvents.splice(0, reg.emailEvents.length - 2000);
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(
    `insert into public.email_events (id, business_id, kind, document_id, to_email, status, error, provider_message_id, mode, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      e.id,
      e.businessId ?? null,
      e.kind,
      e.documentId ?? null,
      e.toEmail,
      e.status,
      e.error ?? null,
      e.providerMessageId ?? null,
      e.mode,
      e.createdAt,
    ]
  );
}

export async function listEmailEvents(filter: {
  limit?: number;
  businessId?: string;
  status?: EmailEvent["status"];
} = {}): Promise<EmailEvent[]> {
  const limit = Math.min(Math.max(filter.limit ?? 100, 1), 500);
  if (!isSupabaseMode()) {
    let items = [...platformRegistry().emailEvents];
    if (filter.businessId) items = items.filter((e) => e.businessId === filter.businessId);
    if (filter.status) items = items.filter((e) => e.status === filter.status);
    return items.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
  }
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.businessId) {
    params.push(filter.businessId);
    where.push(`business_id = $${params.length}::uuid`);
  }
  if (filter.status) {
    params.push(filter.status);
    where.push(`status = $${params.length}`);
  }
  params.push(limit);
  const client = await sqlClient();
  const rows = await client.query(
    `select * from public.email_events
      ${where.length ? `where ${where.join(" and ")}` : ""}
      order by created_at desc limit $${params.length}`,
    params
  );
  return rows.map(emailEventFromRow);
}

export async function countEmailEventsSince(sinceIso: string): Promise<{ sent: number; failed: number }> {
  if (!isSupabaseMode()) {
    const items = platformRegistry().emailEvents.filter((e) => e.createdAt >= sinceIso);
    return {
      sent: items.filter((e) => e.status === "sent").length,
      failed: items.filter((e) => e.status !== "sent").length,
    };
  }
  const client = await sqlClient();
  const rows = await client.query(
    `select
       count(*) filter (where status = 'sent')::int as sent,
       count(*) filter (where status <> 'sent')::int as failed
     from public.email_events where created_at >= $1`,
    [sinceIso]
  );
  return { sent: Number(rows[0]?.sent ?? 0), failed: Number(rows[0]?.failed ?? 0) };
}

/* --------------------------- inaktiverade företag --------------------------- */

export async function setBusinessDisabled(
  businessId: string,
  disabled: boolean,
  byUserId: string,
  at = new Date().toISOString()
): Promise<void> {
  if (!isSupabaseMode()) {
    const reg = platformRegistry();
    reg.disabledBusinesses = reg.disabledBusinesses.filter((d) => d.businessId !== businessId);
    if (disabled) reg.disabledBusinesses.push({ businessId, disabledAt: at, disabledBy: byUserId });
    commitPlatformRegistry();
    return;
  }
  const client = await sqlClient();
  await client.query(`update public.businesses set disabled_at = $2 where id = $1`, [
    businessId,
    disabled ? at : null,
  ]);
}

export async function businessDisabledAt(businessId: string): Promise<string | null> {
  if (!isSupabaseMode()) {
    return platformRegistry().disabledBusinesses.find((d) => d.businessId === businessId)?.disabledAt ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select disabled_at from public.businesses where id = $1`, [businessId]);
  return rows[0]?.disabled_at ? new Date(rows[0].disabled_at as string).toISOString() : null;
}

/** Lätt namnuppslag för skalindikatorer (supportsessionens företag m.m.). */
export async function businessNameById(businessId: string): Promise<string | null> {
  if (!isSupabaseMode()) {
    const { activeMembershipsForBusiness } = await import("../collaboration/registry");
    return activeMembershipsForBusiness(businessId)[0]?.businessName ?? null;
  }
  const client = await sqlClient();
  const rows = await client.query(`select name from public.businesses where id = $1`, [businessId]);
  return rows[0]?.name ? String(rows[0].name) : null;
}
