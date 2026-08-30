/**
 * Admin-audit: central, oföränderlig logg över alla plattformsadministrativa
 * handlingar. Skrivs i samma flöde som handlingen. Admins kan aldrig radera
 * sin egen historik via UI:t – tabellen är INSERT-only (DB-trigger) och
 * JSON-läget exponerar ingen raderingsväg.
 *
 * Metadata är icke-känslig JSON: aldrig personnummer, aldrig tokens, aldrig
 * lösenord eller nycklar.
 */
import { uid } from "../ids";
import { insertAdminAuditRow, listAdminAudit } from "./store";
import type { AdminAuditEntry, PlatformAdmin } from "./types";

export type AdminAuditAction =
  | "admin_bootstrap"
  | "admin_invited"
  | "admin_invite_resent"
  | "admin_invite_revoked"
  | "admin_invite_accepted"
  | "admin_disabled"
  | "admin_enabled"
  | "admin_removed"
  | "support_session_started"
  | "support_session_ended"
  | "support_write"
  | "ticket_status_changed"
  | "ticket_assigned"
  | "user_disabled"
  | "user_enabled"
  | "user_deleted"
  | "user_verification_resent"
  | "business_disabled"
  | "business_enabled"
  | "business_deleted"
  | "accountant_invite_resent"
  | "sensitive_data_revealed";

export async function writeAdminAudit(
  actor: Pick<PlatformAdmin, "userId" | "email" | "role">,
  entry: {
    action: AdminAuditAction;
    targetType?: string;
    targetId?: string;
    businessId?: string;
    metadata?: Record<string, unknown>;
  }
): Promise<AdminAuditEntry> {
  const row: AdminAuditEntry = {
    id: uid(),
    adminUserId: actor.userId,
    adminEmail: actor.email,
    adminRole: actor.role,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId,
    businessId: entry.businessId,
    metadata: entry.metadata ?? {},
    createdAt: new Date().toISOString(),
  };
  await insertAdminAuditRow(row);
  return row;
}

export { listAdminAudit };
