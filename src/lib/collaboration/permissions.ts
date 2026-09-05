/**
 * En behörighetsmatris för Samarbeta / redovisningsytan.
 * Roll är per företag – aldrig globalt på användaren.
 * Ägare och konsult delar samma bokföringsmotor; skillnaden är vad som FÅR göras.
 */
import type { BusinessRole, CollaborationRole } from "../types";

export const OWNER_ROLES: readonly BusinessRole[] = ["owner", "admin", "member"];
export const ACCOUNTING_ROLES: readonly CollaborationRole[] = ["accounting_consultant", "auditor"];

export type CollaborationCapability =
  | "read_accounting"
  | "write_accounting"
  | "categorize"
  | "match_payment"
  | "correct_voucher"
  | "vat"
  | "reconcile"
  | "year_end"
  | "export_accounting"
  | "prepare_supplier_payment"
  | "submit_bank_payment"
  | "prepare_filing"
  | "submit_filing"
  | "send_invoice"
  | "create_quote"
  | "change_website"
  | "change_jobs"
  | "buy_domain"
  | "invite_collaborator"
  | "revoke_collaborator"
  | "request_client_information"
  | "manage_customers"
  | "reveal_personnummer";

const CONSULTANT: ReadonlySet<CollaborationCapability> = new Set([
  "read_accounting",
  "write_accounting",
  "categorize",
  "match_payment",
  "correct_voucher",
  "vat",
  "reconcile",
  "year_end",
  "export_accounting",
  "prepare_supplier_payment",
  // Konsulten upprättar och genererar deklarationsfilen. Att signera och lämna
  // in den är bolagets egen handling och kräver submit_filing.
  "prepare_filing",
  "request_client_information",
]);

const AUDITOR: ReadonlySet<CollaborationCapability> = new Set([
  "read_accounting",
  "export_accounting",
]);

const OWNER: ReadonlySet<CollaborationCapability> = new Set([
  "read_accounting",
  "write_accounting",
  "categorize",
  "match_payment",
  "correct_voucher",
  "vat",
  "reconcile",
  "year_end",
  "export_accounting",
  "prepare_supplier_payment",
  "submit_bank_payment",
  "prepare_filing",
  "submit_filing",
  "send_invoice",
  "create_quote",
  "change_website",
  "change_jobs",
  "buy_domain",
  "invite_collaborator",
  "revoke_collaborator",
  "request_client_information",
  "manage_customers",
  "reveal_personnummer",
]);

const BY_ROLE: Record<BusinessRole, ReadonlySet<CollaborationCapability>> = {
  owner: OWNER,
  admin: OWNER,
  member: new Set(
    [...OWNER].filter((c) => c !== "invite_collaborator" && c !== "revoke_collaborator")
  ),
  accounting_consultant: CONSULTANT,
  auditor: AUDITOR,
};

export function isOwnerRole(role: BusinessRole | null | undefined): boolean {
  return role != null && (OWNER_ROLES as readonly string[]).includes(role);
}

export function isAccountingRole(role: BusinessRole | null | undefined): role is CollaborationRole {
  return role === "accounting_consultant" || role === "auditor";
}

export function roleLabel(role: BusinessRole): string {
  if (role === "accounting_consultant") return "Redovisningskonsult";
  if (role === "auditor") return "Revisor";
  if (role === "owner") return "Ägare";
  if (role === "admin") return "Administratör";
  return "Medlem";
}

export function can(role: BusinessRole | null | undefined, capability: CollaborationCapability): boolean {
  if (!role) return false;
  return BY_ROLE[role].has(capability);
}

export function assertCan(role: BusinessRole | null | undefined, capability: CollaborationCapability): void {
  if (can(role, capability)) return;
  throw new CollaborationDeniedError(capability, role);
}

/**
 * Läsvägens grind (withBusinessRead). Redovisningsroller SKA släppas igenom:
 * SIE-export, kvitton, inkorgens bilagor och betalfiler är läsningar som både
 * konsult och revisor har rätt till. Skickas en läsning genom skrivgrinden
 * nedan i stället nekas de rollerna, vilket är fel.
 */
export function assertReadAccess(role: BusinessRole | null | undefined): void {
  assertCan(role, "read_accounting");
}

/**
 * Skrivvägens grind (withBusiness). Med capability avgör behörighetsmatrisen.
 * UTAN capability är åtgärden ägaryteexklusiv – det är standardläget för allt
 * som inte uttryckligen delats med redovisningsytan.
 */
export function assertWriteAccess(
  role: BusinessRole | null | undefined,
  capability?: CollaborationCapability
): void {
  if (capability) {
    assertCan(role, capability);
    return;
  }
  if (isAccountingRole(role)) {
    throw new Error("Den här åtgärden är inte tillgänglig från redovisningsytan.");
  }
}

export class CollaborationDeniedError extends Error {
  readonly capability: CollaborationCapability;
  readonly role: BusinessRole | null;
  constructor(capability: CollaborationCapability, role: BusinessRole | null | undefined) {
    super(
      role === "auditor"
        ? "Revisorer har endast läsbehörighet."
        : "Du har inte behörighet att göra det här i det här företaget."
    );
    this.name = "CollaborationDeniedError";
    this.capability = capability;
    this.role = role ?? null;
  }
}

/** Verktyg som konsulten ALDRIG får anropa – även om klienten skickar businessId. */
export const CONSULTANT_FORBIDDEN_TOOLS: readonly string[] = [
  "send_invoice",
  "send_quote",
  "send_reminders",
  "follow_up_quotes",
  "create_quote",
  "create_invoice",
  "create_final_invoice",
  "create_job_invoice",
  "create_assignment",
  "update_assignment_status",
  "complete_job",
  "reopen_job",
  "delete_or_archive_job",
  "register_job_time",
  "add_job_material",
  "propose_invoice_for_customer",
  "propose_extra_from_notes",
  "generate_website",
  "activate_website",
  "activate_collaboration",
  "publish_website",
  "purchase_domain",
  "submit_supplier_payment",
  "update_business_profile",
];

export const AUDITOR_FORBIDDEN_TOOLS: readonly string[] = [
  ...CONSULTANT_FORBIDDEN_TOOLS,
  "book_expense",
  "answer_expense_question",
  "prepare_supplier_payment",
  "cancel_supplier_payment",
  "bokfor_bokslutsposter",
  "slutfor_bokslut",
  "angra_bokforing",
  "ratta_bokforing",
  "markera_moms_deklarerad",
  "create_customer",
  "create_reminder",
  "update_reminder",
  "complete_reminder",
  "snooze_reminder",
  "dismiss_reminder",
  "snooze_attention",
];

export function toolAllowedForRole(tool: string, role: BusinessRole | null | undefined): boolean {
  if (!role) return false;
  if (isOwnerRole(role)) return true;
  if (role === "auditor") return !AUDITOR_FORBIDDEN_TOOLS.includes(tool);
  if (role === "accounting_consultant") return !CONSULTANT_FORBIDDEN_TOOLS.includes(tool);
  return false;
}
