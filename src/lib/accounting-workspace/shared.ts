/**
 * Klientsäkra delar av redovisningsarbetsytan: typen, behörighetsfrågan och
 * länköversättningen. Ingen store, ingen I/O – kan importeras från både
 * server- och klientkomponenter.
 */
import { can, type CollaborationCapability } from "../collaboration/permissions";
import type { BusinessRole } from "../types";
import { OWNER_WORKSPACE_BASE, workspaceHref } from "./tabs";

export type WorkspaceSurface = "owner" | "portfolio";

export interface WorkspaceActor {
  userId: string;
  name: string;
  email: string;
}

/**
 * Allt en vy behöver veta om vem som arbetar var. Skillnaderna mellan ägare
 * och konsult kommer ENBART härifrån: businessId, roll/capabilities, basväg
 * och om portföljnavigeringen (klientväljaren) ska visas.
 */
export interface AccountingWorkspace {
  surface: WorkspaceSurface;
  businessId: string;
  businessName: string;
  actor: WorkspaceActor;
  role: BusinessRole;
  capabilities: readonly CollaborationCapability[];
  basePath: string;
  /**
   * Skickas med till server actions från portföljytan så att klienten –
   * inte cookien – avgör vems böcker som skrivs. På ägarytan undefined.
   */
  actionBusinessId?: string;
  /** Visa klientväljare/portföljnavigering. */
  showPortfolioNav: boolean;
  /** Är requesten en demo (JSON-läge, /demo eller is_demo-företag)? */
  demo: boolean;
}

export function wsCan(ws: Pick<AccountingWorkspace, "role">, capability: CollaborationCapability): boolean {
  return can(ws.role, capability);
}

/** Ägaradress → arbetsytans adress (identitet på ägarytan). */
export function wsHref(ws: Pick<AccountingWorkspace, "basePath">, ownerHref: string): string {
  return workspaceHref(ws.basePath, ownerHref);
}

export function isOwnerSurface(ws: Pick<AccountingWorkspace, "basePath">): boolean {
  return ws.basePath === OWNER_WORKSPACE_BASE;
}

/** Läsläge för en vy: aktören saknar den capability som vyns skrivknappar kräver. */
export function wsReadOnly(ws: Pick<AccountingWorkspace, "role">, capability: CollaborationCapability): boolean {
  return !wsCan(ws, capability);
}

export const ALL_CAPABILITIES: readonly CollaborationCapability[] = [
  "read_accounting",
  "write_accounting",
  "categorize",
  "match_payment",
  "correct_voucher",
  "vat",
  "reconcile",
  "period_close",
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
  "manage_wholesalers",
  "order_materials",
  "import_data",
];

export function capabilitiesForRole(role: BusinessRole): CollaborationCapability[] {
  return ALL_CAPABILITIES.filter((c) => can(role, c));
}
