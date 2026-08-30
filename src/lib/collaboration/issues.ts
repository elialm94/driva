/**
 * Redovisningskön – SAMMA åtgärdsmotor som Hem, filtrerad och märkt
 * med konsultens ärendetyper. Ingen parallell issue-tabell.
 */
import { attentionKind, type AttentionKind } from "../services/action-issue";
import type { BusinessAction } from "../services/actions";

export type AccountantIssueType =
  | "MISSING_RECEIPT"
  | "UNCLEAR_CATEGORY"
  | "UNMATCHED_PAYMENT"
  | "VAT_REVIEW"
  | "BANK_RECONCILIATION_DIFF"
  | "ACCOUNTING_CORRECTION"
  | "PERIOD_CLOSE"
  | "YEAR_END_REVIEW"
  | "CLIENT_REQUEST";

export const ACCOUNTANT_ISSUE_LABEL: Record<AccountantIssueType, string> = {
  MISSING_RECEIPT: "Saknar kvitto",
  UNCLEAR_CATEGORY: "Oklar kategori",
  UNMATCHED_PAYMENT: "Omatchad betalning",
  VAT_REVIEW: "Moms",
  BANK_RECONCILIATION_DIFF: "Bankavstämning",
  ACCOUNTING_CORRECTION: "Rättelse",
  PERIOD_CLOSE: "Periodstängning",
  YEAR_END_REVIEW: "Bokslut",
  CLIENT_REQUEST: "Väntar på kunden",
};

const KIND_TO_ISSUE: Partial<Record<AttentionKind, AccountantIssueType>> = {
  missingReceipt: "MISSING_RECEIPT",
  accountingQuestion: "UNCLEAR_CATEGORY",
  bankMatch: "UNMATCHED_PAYMENT",
  bankUnexplained: "BANK_RECONCILIATION_DIFF",
  vat: "VAT_REVIEW",
};

/** Kö-ordning: försenat/deadline → blockerare → undantag → lägre granskning. */
const ISSUE_RANK: Record<AccountantIssueType, number> = {
  VAT_REVIEW: 0,
  BANK_RECONCILIATION_DIFF: 1,
  UNMATCHED_PAYMENT: 2,
  UNCLEAR_CATEGORY: 3,
  MISSING_RECEIPT: 4,
  ACCOUNTING_CORRECTION: 5,
  PERIOD_CLOSE: 6,
  YEAR_END_REVIEW: 7,
  CLIENT_REQUEST: 8,
};

export function accountantIssueType(action: Pick<BusinessAction, "id" | "category">): AccountantIssueType | null {
  if (action.id.startsWith("client-request-")) return "CLIENT_REQUEST";
  if (action.id.startsWith("correction-") || action.id.startsWith("rattelse-")) return "ACCOUNTING_CORRECTION";
  if (action.id.startsWith("period-close-") || action.id.startsWith("periodstang-")) return "PERIOD_CLOSE";
  if (action.id.startsWith("year-end-") || action.id.startsWith("bokslut-")) return "YEAR_END_REVIEW";
  const kind = attentionKind(action);
  if (kind && KIND_TO_ISSUE[kind]) return KIND_TO_ISSUE[kind]!;
  if (action.category === "accounting" || action.category === "vat") {
    if (action.id.startsWith("vat-")) return "VAT_REVIEW";
    return "UNCLEAR_CATEGORY";
  }
  return null;
}

export function isAccountantAction(action: Pick<BusinessAction, "id" | "category">): boolean {
  return accountantIssueType(action) != null;
}

export function accountantQueue(actions: BusinessAction[]): BusinessAction[] {
  return actions
    .filter(isAccountantAction)
    .slice()
    .sort((a, b) => {
      const pa = a.priority === "urgent" ? 0 : a.priority === "action" ? 1 : 2;
      const pb = b.priority === "urgent" ? 0 : b.priority === "action" ? 1 : 2;
      if (pa !== pb) return pa - pb;
      const ta = accountantIssueType(a);
      const tb = accountantIssueType(b);
      const ra = ta ? ISSUE_RANK[ta] : 99;
      const rb = tb ? ISSUE_RANK[tb] : 99;
      if (ra !== rb) return ra - rb;
      return a.id.localeCompare(b.id);
    });
}

export type AccountantFilter = "alla" | "forsenat" | "moms" | "underlag" | "bank" | "granskning" | "vantar";

/** UI-lane: aktivt arbete, väntar på kunden, eller redo att granskas. */
export type AccountantWorkState = "att_gora" | "vantar" | "granska";

export function accountantWorkState(action: BusinessAction): AccountantWorkState {
  const type = accountantIssueType(action);
  if (type === "CLIENT_REQUEST") return "vantar";
  if (type === "VAT_REVIEW" || type === "YEAR_END_REVIEW" || type === "PERIOD_CLOSE") return "granska";
  return "att_gora";
}

export function isWaitingForClient(action: BusinessAction): boolean {
  return accountantWorkState(action) === "vantar";
}

export function matchesAccountantFilter(action: BusinessAction, filter: AccountantFilter): boolean {
  const type = accountantIssueType(action);
  if (filter === "vantar") return accountantWorkState(action) === "vantar";
  if (filter === "granskning") return accountantWorkState(action) === "granska";
  if (filter === "alla") return accountantWorkState(action) !== "vantar";
  if (filter === "forsenat") return action.priority === "urgent";
  if (filter === "moms") return type === "VAT_REVIEW";
  if (filter === "underlag") return type === "MISSING_RECEIPT";
  if (filter === "bank") return type === "UNMATCHED_PAYMENT" || type === "BANK_RECONCILIATION_DIFF";
  return true;
}

export type ClientHealth = "klart" | "saker" | "forsenat";

export function clientHealth(attention: BusinessAction[]): ClientHealth {
  if (attention.some((a) => a.priority === "urgent")) return "forsenat";
  const queue = accountantQueue(attention);
  if (queue.length === 0) return "klart";
  return "saker";
}

export function healthLabel(health: ClientHealth, count: number): string {
  if (health === "klart") return "Klart";
  if (health === "forsenat") return "Försenat";
  return count === 1 ? "1 sak" : `${count} saker`;
}
