/**
 * Multi-klient: lista, sök, hälsa och korsföretags-kö.
 * Åtgärder kommer ALLTID från getBusinessActions() per företag – aldrig en
 * parallell issue-modell.
 */
import type { BusinessAction } from "../services/actions";
import { accountantQueue, clientHealth, healthLabel, type ClientHealth } from "./issues";
import {
  accountingMemberships,
  isLastActiveToday,
  type CollaborationMembership,
} from "./registry";

export interface ClientSummary {
  businessId: string;
  name: string;
  role: CollaborationMembership["role"];
  lastActiveAt?: string;
  lastActiveToday: boolean;
  openCount: number;
  urgentCount: number;
  health: ClientHealth;
  healthLabel: string;
}

export function listAccountantClients(
  userId: string,
  now = new Date()
): CollaborationMembership[] {
  return accountingMemberships(userId).sort((a, b) => a.businessName.localeCompare(b.businessName, "sv"));
}

export function searchClients(userId: string, query: string): CollaborationMembership[] {
  const q = query.trim().toLowerCase();
  const all = listAccountantClients(userId);
  if (!q) return all;
  return all.filter((c) => c.businessName.toLowerCase().includes(q));
}

export function summarizeClient(
  membership: CollaborationMembership,
  attention: BusinessAction[],
  now = new Date()
): ClientSummary {
  const queue = accountantQueue(attention);
  const health = clientHealth(attention);
  return {
    businessId: membership.businessId,
    name: membership.businessName,
    role: membership.role,
    lastActiveAt: membership.lastActiveAt,
    lastActiveToday: isLastActiveToday(membership.lastActiveAt, now),
    openCount: queue.length,
    urgentCount: queue.filter((a) => a.priority === "urgent").length,
    health,
    healthLabel: healthLabel(health, queue.length),
  };
}

/** Kompakt, konkret status för portföljraden – aldrig poäng. */
export function clientRowStatus(
  s: Pick<ClientSummary, "health" | "openCount" | "urgentCount">,
  extra?: { vatDueDays?: number | null; bankOk?: boolean }
): string {
  if (s.health === "forsenat") {
    const n = s.urgentCount || 1;
    const fors = n === 1 ? "1 försenad" : `${n} försenade`;
    return s.openCount > n ? `${s.openCount} saker · ${fors}` : fors;
  }
  const vatDays = extra?.vatDueDays;
  if (vatDays != null && vatDays >= 0 && vatDays <= 14) {
    if (vatDays === 0) return "Moms idag";
    if (vatDays === 1) return "Moms imorgon";
    return `Moms om ${vatDays} dagar`;
  }
  if (extra?.bankOk === false) return "Bank ej avstämd";
  if (s.openCount === 0) return "Klart ✓";
  return s.openCount === 1 ? "1 sak" : `${s.openCount} saker`;
}

export interface CrossClientItem {
  businessId: string;
  businessName: string;
  action: BusinessAction;
}

export function mergeCrossClientQueue(items: CrossClientItem[]): CrossClientItem[] {
  const ranked = items.map((item) => ({
    item,
    urgent: item.action.priority === "urgent" ? 0 : item.action.priority === "action" ? 1 : 2,
  }));
  ranked.sort((a, b) => {
    if (a.urgent !== b.urgent) return a.urgent - b.urgent;
    return a.item.businessName.localeCompare(b.item.businessName, "sv") || a.item.action.id.localeCompare(b.item.action.id);
  });
  return ranked.map((r) => r.item);
}

export function queueCounts(items: CrossClientItem[]): { items: number; clients: number } {
  const clients = new Set(items.map((i) => i.businessId));
  return { items: items.length, clients: clients.size };
}

export function landingHeadline(items: number, clients: number): string {
  if (items === 0) return "Inget som behöver hanteras just nu.";
  const sak = items === 1 ? "sak" : "saker";
  const klient = clients === 1 ? "klient" : "klienter";
  return `${items} ${sak} behöver hanteras · över ${clients} ${klient}`;
}
