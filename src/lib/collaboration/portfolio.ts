/**
 * Portföljläsning för redovisningskonsulten: en genomgång per klient.
 * Supabase: snapshotar laddas parallellt. JSON: bara det lokala företaget
 * har data – övriga demo-klienter är ärligt tomma.
 */
import { bankReconciliation } from "../accounting/reconciliation";
import { vatPeriods, type VatPeriodSummary } from "../accounting/vat";
import { LOCAL_JSON_BUSINESS_ID } from "./actor";
import { dagarTill } from "../format";
import { getBusinessActions, type BusinessAction } from "../services/actions";
import { isSupabaseMode } from "../storage/config";
import { loadStateSnapshot } from "../storage/adapter-supabase";
import { runInTenantContext } from "../storage/context";
import { db } from "../store";
import {
  listAccountantClients,
  mergeCrossClientQueue,
  summarizeClient,
  type ClientSummary,
  type CrossClientItem,
} from "./clients";
import {
  accountantQueue,
  accountantWorkState,
  matchesAccountantFilter,
  type AccountantFilter,
} from "./issues";
import type { CollaborationMembership } from "./registry";

export interface VatDeadline {
  businessId: string;
  businessName: string;
  periodLabel: string;
  dueDate: string;
  days: number;
}

export interface ClientWorkSnapshot {
  membership: CollaborationMembership;
  name: string;
  summary: ClientSummary;
  queue: BusinessAction[];
  waiting: BusinessAction[];
  bookedThrough?: string;
  bankOk: boolean;
  bankConnected: boolean;
  bankUnexplained: number;
  nextVat?: { periodLabel: string; dueDate: string; days: number; state: VatPeriodSummary["state"] };
}

function nextVatFromPeriods(periods: VatPeriodSummary[]): ClientWorkSnapshot["nextVat"] {
  const open = periods
    .filter((p) => p.state === "att_deklarera" || p.state === "pagaende")
    .slice()
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const hit = open[0];
  if (!hit) return undefined;
  return {
    periodLabel: hit.period.label,
    dueDate: hit.dueDate,
    days: dagarTill(hit.dueDate),
    state: hit.state,
  };
}

function snapshotFromCurrentStore(membership: CollaborationMembership): ClientWorkSnapshot {
  const attention = getBusinessActions().attention;
  const queueAll = accountantQueue(attention);
  const queue = queueAll.filter((a) => accountantWorkState(a) !== "vantar");
  const waiting = queueAll.filter((a) => accountantWorkState(a) === "vantar");
  const recon = bankReconciliation();
  const vat = nextVatFromPeriods(vatPeriods());
  const name = db().settings.name || membership.businessName;
  return {
    membership,
    name,
    summary: summarizeClient({ ...membership, businessName: name }, attention),
    queue,
    waiting,
    bookedThrough: db().accounting.lockedThrough,
    bankOk: recon.ok,
    bankConnected: db().bankAccounts.length > 0,
    bankUnexplained: recon.unexplained,
    nextVat: vat,
  };
}

function emptySnapshot(membership: CollaborationMembership): ClientWorkSnapshot {
  const attention: BusinessAction[] = [];
  return {
    membership,
    name: membership.businessName,
    summary: summarizeClient(membership, attention),
    queue: [],
    waiting: [],
    bankOk: true,
    bankConnected: false,
    bankUnexplained: 0,
  };
}

export async function attentionForBusiness(businessId: string): Promise<BusinessAction[]> {
  const snap = await loadClientWork(businessId);
  return [...snap.queue, ...snap.waiting];
}

async function loadClientWork(businessId: string, membership?: CollaborationMembership): Promise<ClientWorkSnapshot> {
  const stub: CollaborationMembership = membership ?? {
    businessId,
    businessName: businessId,
    userId: "",
    role: "accounting_consultant",
    createdAt: new Date().toISOString(),
  };
  if (!isSupabaseMode()) {
    if (businessId !== LOCAL_JSON_BUSINESS_ID) return emptySnapshot(stub);
    return snapshotFromCurrentStore(stub);
  }
  const state = await loadStateSnapshot(businessId);
  return runInTenantContext(
    {
      businessId,
      userId: null,
      writable: false,
      state,
      baseline: state,
      stateVersion: 0,
      dirty: false,
    },
    () => snapshotFromCurrentStore(stub)
  );
}

export async function loadAccountantClient(
  userId: string,
  businessId: string
): Promise<ClientWorkSnapshot | null> {
  const clients = listAccountantClients(userId);
  const membership = clients.find((c) => c.businessId === businessId);
  if (!membership) return null;
  return loadClientWork(businessId, membership);
}

export async function loadAccountantPortfolio(userId: string): Promise<ClientWorkSnapshot[]> {
  const clients = listAccountantClients(userId);
  if (clients.length === 0) return [];
  if (!isSupabaseMode()) {
    return clients.map((c) =>
      c.businessId === LOCAL_JSON_BUSINESS_ID ? snapshotFromCurrentStore(c) : emptySnapshot(c)
    );
  }
  return Promise.all(clients.map((c) => loadClientWork(c.businessId, c)));
}

export function portfolioQueue(
  snapshots: ClientWorkSnapshot[],
  filter: AccountantFilter = "alla"
): CrossClientItem[] {
  const cross: CrossClientItem[] = [];
  for (const s of snapshots) {
    const source = filter === "vantar" ? s.waiting : filter === "alla" ? s.queue : [...s.queue, ...s.waiting];
    for (const action of source) {
      if (!matchesAccountantFilter(action, filter)) continue;
      cross.push({
        businessId: s.membership.businessId,
        businessName: s.name,
        action: {
          ...action,
          href: accountantActionHref(s.membership.businessId, action),
          clientName: s.name,
        },
      });
    }
  }
  return mergeCrossClientQueue(cross);
}

export function accountantActionHref(businessId: string, action: BusinessAction): string {
  if (action.id.startsWith("vat-") || action.category === "vat") {
    return `/redovisning/k/${businessId}/moms`;
  }
  if (action.id.startsWith("bank-") || action.id === "bank-unexplained") {
    return `/redovisning/k/${businessId}/bank`;
  }
  if (action.id.startsWith("year-end-") || action.id.startsWith("bokslut-")) {
    return `/redovisning/k/${businessId}/bokslut`;
  }
  return `/redovisning/k/${businessId}?sak=${encodeURIComponent(action.id)}`;
}

export function upcomingVatDeadlines(snapshots: ClientWorkSnapshot[], withinDays = 7): VatDeadline[] {
  const rows: VatDeadline[] = [];
  for (const s of snapshots) {
    if (!s.nextVat || s.nextVat.days < 0 || s.nextVat.days > withinDays) continue;
    rows.push({
      businessId: s.membership.businessId,
      businessName: s.name,
      periodLabel: s.nextVat.periodLabel,
      dueDate: s.nextVat.dueDate,
      days: s.nextVat.days,
    });
  }
  rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.businessName.localeCompare(b.businessName, "sv"));
  return rows;
}

export function groupQueueByClient(items: CrossClientItem[]): { businessId: string; businessName: string; items: CrossClientItem[] }[] {
  const order: string[] = [];
  const map = new Map<string, { businessId: string; businessName: string; items: CrossClientItem[] }>();
  for (const item of items) {
    let g = map.get(item.businessId);
    if (!g) {
      g = { businessId: item.businessId, businessName: item.businessName, items: [] };
      map.set(item.businessId, g);
      order.push(item.businessId);
    }
    g.items.push(item);
  }
  return order.map((id) => map.get(id)!);
}
