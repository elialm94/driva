/**
 * ROT/RUT-redo innan utskick.
 *
 * Utkast får sakna personnummer och bostad. Innan offerten eller fakturan
 * skickas måste dokumentet ha giltigt personnummer på den som får avdraget
 * och en bostad som är explicit sparad på dokumentet. Kundens fastigheter
 * räcker inte – relationen måste ligga på just den här offerten/fakturan.
 *
 * UI och server delar den här funktionen. Felkoder är interna; användaren
 * ser bara den svenska texten.
 */
import { isPersonnummerFormat } from "./personnummer";
import type { Customer, RotRut } from "./types";
import { workLocationsOf } from "./services/work-locations";

export type TaxReductionDocumentKind = "offert" | "faktura";

export type TaxReductionSendIssueCode = "personnummer" | "property";

export interface TaxReductionSendIssue {
  code: TaxReductionSendIssueCode;
  message: string;
}

export interface TaxReductionSendDocument {
  kind: TaxReductionDocumentKind;
  taxReduction: RotRut | null | undefined;
  personalIdentityNumber?: string | null;
  workLocationId?: string | null;
  customerWorkLocationIds?: readonly string[];
}

export type TaxReductionSendReadiness =
  | { ok: true; issues: [] }
  | { ok: false; issues: TaxReductionSendIssue[] };

export class TaxReductionNotReadyError extends Error {
  readonly issues: TaxReductionSendIssue[];
  constructor(issues: TaxReductionSendIssue[]) {
    super(issues.map((issue) => issue.message).join(" "));
    this.name = "TaxReductionNotReadyError";
    this.issues = issues;
  }
}

function kindLabel(kind: TaxReductionDocumentKind): string {
  return kind === "offert" ? "offerten" : "fakturan";
}

function reductionLabel(type: "rot" | "rut"): string {
  return type === "rot" ? "ROT-avdraget" : "RUT-avdraget";
}

function hasExplicitProperty(
  workLocationId: string | null | undefined,
  customerWorkLocationIds?: readonly string[]
): boolean {
  const id = workLocationId?.trim();
  if (!id) return false;
  if (!customerWorkLocationIds) return true;
  return customerWorkLocationIds.includes(id);
}

/** Giltigt svenskt personnummer – samma regler som kundkortet. */
export function isValidTaxReductionPersonnummer(value?: string | null): boolean {
  return isPersonnummerFormat((value ?? "").trim());
}

/**
 * Om ROT/RUT är valt och dokumentet saknar bostad, men kunden har precis en,
 * väljs den och ska sparas på dokumentet. Flera bostäder kräver aktivt val.
 * Första bostaden gissas aldrig om det finns mer än en.
 */
export function resolvePersistedWorkLocationId(input: {
  taxReduction: RotRut | null | undefined;
  workLocationId?: string | null;
  customerWorkLocationIds: readonly string[];
}): string | undefined {
  const ids = input.customerWorkLocationIds.filter(Boolean);
  const current = input.workLocationId?.trim();
  if (current && ids.includes(current)) return current;
  if (input.taxReduction && !current && ids.length === 1) return ids[0];
  return undefined;
}

export function validateTaxReductionSendReadiness(
  document: TaxReductionSendDocument
): TaxReductionSendReadiness {
  const rot = document.taxReduction;
  if (!rot) return { ok: true, issues: [] };

  const issues: TaxReductionSendIssue[] = [];
  const pnr = (document.personalIdentityNumber ?? "").trim();
  if (!pnr) {
    issues.push({
      code: "personnummer",
      message: `Personnummer saknas för ${reductionLabel(rot.type)}.`,
    });
  } else if (!isValidTaxReductionPersonnummer(pnr)) {
    issues.push({
      code: "personnummer",
      message: "Ange personnummer med 10 eller 12 siffror.",
    });
  }

  if (!hasExplicitProperty(document.workLocationId, document.customerWorkLocationIds)) {
    issues.push({
      code: "property",
      message: `Ingen bostad är vald på ${kindLabel(document.kind)}.`,
    });
  }

  return issues.length ? { ok: false, issues: issues as [TaxReductionSendIssue, ...TaxReductionSendIssue[]] } : { ok: true, issues: [] };
}

export function assertTaxReductionSendReady(document: TaxReductionSendDocument): void {
  const result = validateTaxReductionSendReadiness(document);
  if (!result.ok) throw new TaxReductionNotReadyError(result.issues);
}

export interface TaxReductionSendBlocker {
  code: TaxReductionSendIssueCode;
  message: string;
  href: string;
  actionLabel: string;
}

export function taxReductionSendBlockers(input: {
  kind: TaxReductionDocumentKind;
  documentId: string;
  customerId: string;
  taxReduction: RotRut | null | undefined;
  personalIdentityNumber?: string | null;
  workLocationId?: string | null;
  customerWorkLocationIds?: readonly string[];
}): TaxReductionSendBlocker[] {
  const result = validateTaxReductionSendReadiness(input);
  if (result.ok) return [];
  const editHref =
    input.kind === "offert"
      ? `/ekonomi/offerter/${input.documentId}/redigera#offert-rot-rut`
      : `/ekonomi/fakturor/${input.documentId}/redigera#faktura-rot-rut`;
  return result.issues.map((issue) =>
    issue.code === "personnummer"
      ? {
          ...issue,
          href: `/kunder/${input.customerId}#kund-personnummer`,
          actionLabel: "Lägg till personnummer",
        }
      : {
          ...issue,
          href: editHref,
          actionLabel: "Välj bostad",
        }
  );
}

export function taxReductionSendInputFromCustomer(
  customer: Customer,
  over: {
    kind: TaxReductionDocumentKind;
    documentId: string;
    taxReduction: RotRut | null | undefined;
    workLocationId?: string | null;
  }
) {
  return {
    kind: over.kind,
    documentId: over.documentId,
    customerId: customer.id,
    taxReduction: over.taxReduction,
    personalIdentityNumber: customer.personalIdentityNumber,
    workLocationId: over.workLocationId,
    customerWorkLocationIds: workLocationsOf(customer).map((location) => location.id),
  };
}
