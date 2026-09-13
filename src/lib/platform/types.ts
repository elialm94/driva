/**
 * Ferva Admin – plattformsdomänen.
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
  /** Data-URL-fallback (JSON-läge / saknad Storage). Aldrig publikt. */
  attachmentDataUrl?: string;
  /** Privat Storage-sökväg i bucketen support_attachments. */
  attachmentPath?: string;
  environment?: string;
  adminNotes?: string;
  resolvedAt?: string;
  resolvedBy?: string;
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

/* ------------------------------- Driftposter -------------------------------- */

export type OpsRecordKind = "restore_drill" | "email_test_outbound" | "email_inbound" | "cron_run";
export type OpsRecordStatus = "ok" | "fel" | "partiell";

/**
 * Verifierbar drifthändelse för systemvyn: senaste dokumenterade restore
 * drill, senaste mejltest, senaste inkommande mejl, senaste cronkörning.
 * summary är icke-känslig JSON (räknare, tider, ansvarig) – aldrig
 * mejlinnehåll, kunddata eller hemligheter.
 */
export interface OpsRecord {
  id: string;
  kind: OpsRecordKind;
  createdAt: string;
  recordedByUserId?: string;
  recordedByEmail?: string;
  status: OpsRecordStatus;
  environment?: string;
  summary: Record<string, unknown>;
}

/* ------------------------------ Villkorsgodkännande ------------------------------ */

export type TermsAcceptanceSource = "signup" | "app" | "checkout" | "admin";

/**
 * Ett aktivt godkännande av en villkorsversion (spec §7). Append-only: varje
 * nytt godkännande blir en ny rad; det senaste per användare avgör om grinden
 * i appen släpper igenom. Ingen IP-adress eller user agent lagras.
 */
export interface TermsAcceptanceRecord {
  id: string;
  userId: string;
  /** Företag i sessionen när godkännandet gjordes (saknas vid registrering). */
  businessId?: string;
  document: "villkor";
  version: string;
  acceptedAt: string;
  source: TermsAcceptanceSource;
  /** E-post vid tillfället – för adminvyn och export; aldrig som nyckel. */
  email?: string;
}

/* ------------------------------ Förslagskvalitet ------------------------------ */

export type SuggestionDecision = "auto" | "accepted" | "changed" | "rejected" | "private";

/**
 * Ett loggat förslagsbeslut för bankklassificeringen – aggregerbart utan
 * känsligt innehåll: ingen motpartstext, inget belopp (bara spann), inget
 * dokumentinnehåll, aldrig personnummer. inputHash är sha256 över den
 * normaliserade motparten + belopp + datum så att samma rad känns igen.
 */
export interface SuggestionEvent {
  id: string;
  businessId?: string;
  createdAt: string;
  direction: "in" | "ut";
  /** Var förslaget kom ifrån: faktura, leverantorsbetalning, regel, verifikation, monster, kunskapsbas, ingen. */
  source: string;
  /** Förslagets nivå när det visades. */
  tier: "saker" | "troligt" | "osakert";
  decision: SuggestionDecision;
  /** Riskflaggor som krävde människa (banking/merchants.ts RiskFlag). */
  humanRequired: string[];
  /** Kunskapsbasens motpartstyp (drivmedel, restaurang …) – aldrig namnet. */
  merchantType?: string;
  kbVersion: string;
  ruleVersion?: number;
  /** LLM-lager: används inte för bankförslag i dag – loggas som null tills det gör det. */
  provider?: string | null;
  model?: string | null;
  promptVersion?: string | null;
  inputHash: string;
  /** Vad förslaget var (banktyp/kategori) och vad användaren till slut valde. */
  suggested?: string;
  finalChoice: string;
  amountBucket: "under_500" | "500_5000" | "over_5000";
}

export function platformRoleLabel(role: PlatformRole | string): string {
  return role === "super_admin" ? "Superadmin" : "Admin";
}

export const SUPPORT_TICKET_STATUS_LABEL: Record<SupportTicketStatus, string> = {
  open: "Öppen",
  in_progress: "Pågår",
  waiting_for_customer: "Väntar på kund",
  resolved: "Löst",
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
