/**
 * Driva Admin – plattformsdomänen.
 *
 * Tre begrepp som ALDRIG blandas ihop:
 *   1. KUND        arbetar i sitt företag (business_memberships).
 *   2. SAMARBETE   uttryckligen beviljad åtkomst till ett företag
 *                  (redovisningskonsult/revisor – också business_memberships).
 *   3. DRIVA ADMIN driver plattformen (platform_admins) – GLOBAL behörighet,
 *                  helt skild från tenantroller.
 *
 * super_admin styr admin-teamet; admin driver plattformen operativt men kan
 * aldrig ta bort/ändra/inaktivera en super_admin. Servern är alltid källan
 * till sanning – UI:t döljer bara det som ändå skulle nekas.
 */

export type PlatformRole = "super_admin" | "admin";

export const SUPER_ADMIN: PlatformRole = "super_admin";
export const PLATFORM_ADMIN: PlatformRole = "admin";

export interface PlatformAdmin {
  id: string;
  userId: string;
  role: PlatformRole;
  /** Denormaliserat för visning/audit (auth.users ägs av Supabase Auth). */
  email: string;
  name: string;
  createdAt: string;
  createdBy?: string;
  disabledAt?: string;
  disabledBy?: string;
}

export interface PlatformAdminInvitation {
  id: string;
  email: string;
  /** Endast admin – super_admin skapas aldrig via inbjudan. */
  role: "admin";
  tokenHash: string;
  invitedByUserId: string;
  invitedByName: string;
  expiresAt: string;
  acceptedAt?: string;
  acceptedByUserId?: string;
  revokedAt?: string;
  revokedByUserId?: string;
  createdAt: string;
}

export type SupportTicketStatus = "open" | "in_progress" | "waiting_for_customer" | "resolved";
export type SupportTicketPriority = "low" | "normal" | "high";

export interface SupportTicket {
  id: string;
  businessId?: string;
  userId?: string;
  userEmail: string;
  userName: string;
  businessName: string;
  subject: string;
  message: string;
  status: SupportTicketStatus;
  priority: SupportTicketPriority;
  assignedAdminId?: string;
  /** Automatiskt bifogad teknisk kontext – kunden skriver aldrig detta själv. */
  route: string;
  userAgent: string;
  appVersion: string;
  attachmentName?: string;
  attachmentDataUrl?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SupportSession {
  id: string;
  adminUserId: string;
  businessId: string;
  reason: string;
  ticketId?: string;
  startedAt: string;
  expiresAt: string;
  endedAt?: string;
}

export interface AdminAuditEntry {
  id: string;
  adminUserId: string;
  adminEmail: string;
  adminRole: PlatformRole | string;
  action: string;
  targetType?: string;
  targetId?: string;
  businessId?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export type EmailEventStatus = "sent" | "failed" | "not_configured";

export interface EmailEvent {
  id: string;
  businessId?: string;
  kind: string;
  documentId?: string;
  toEmail: string;
  status: EmailEventStatus;
  error?: string;
  providerMessageId?: string;
  mode: "live" | "test";
  createdAt: string;
}

export function platformRoleLabel(role: PlatformRole | string): string {
  return role === "super_admin" ? "Superadmin" : "Admin";
}

export const SUPPORT_TICKET_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Ny",
  in_progress: "Pågående",
  waiting_for_customer: "Väntar på kund",
  resolved: "Klart",
};

export const SUPPORT_TICKET_PRIORITY_LABEL: Record<SupportTicketPriority, string> = {
  low: "Låg",
  normal: "Normal",
  high: "Hög",
};

export class PlatformAccessError extends Error {
  readonly status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = "PlatformAccessError";
    this.status = status;
  }
}
