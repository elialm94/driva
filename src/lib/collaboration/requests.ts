/**
 * request_client_information – konsulten ber ägaren om underlag.
 * Syns på Hem via samma åtgärdsmotor. När kvittot laddas upp löses båda.
 */
import { db, save } from "../store";
import { uid } from "../ids";
import { kr } from "../format";
import { logAudit } from "../accounting/audit";
import type { ClientInformationRequest, CollaborationRole } from "../types";
import { tenantContext } from "../storage/context";

export function clientInformationRequests(): ClientInformationRequest[] {
  return db().clientInformationRequests ?? [];
}

export function openClientRequests(): ClientInformationRequest[] {
  return clientInformationRequests().filter((r) => !r.resolvedAt);
}

export function requestClientInformation(input: {
  kind?: ClientInformationRequest["kind"];
  expenseId?: string;
  supplierInvoiceId?: string;
  message?: string;
  requestedByUserId: string;
  requestedByName: string;
  requestedByRole: CollaborationRole;
}): ClientInformationRequest {
  const data = db();
  data.clientInformationRequests ??= [];

  if (input.expenseId) {
    const existing = data.clientInformationRequests.find(
      (r) => r.expenseId === input.expenseId && !r.resolvedAt
    );
    if (existing) return existing;
  }

  let message = input.message?.trim() ?? "";
  if (!message && input.expenseId) {
    const expense = data.expenses.find((e) => e.id === input.expenseId);
    if (expense) {
      message = `${input.requestedByName} behöver kvittot från ${expense.supplier}, ${kr(expense.amount)}.`;
    }
  }
  if (!message) {
    message = `${input.requestedByName} behöver mer underlag för bokföringen.`;
  }

  const req: ClientInformationRequest = {
    id: uid(),
    kind: input.kind ?? "receipt",
    title: message,
    message,
    expenseId: input.expenseId,
    supplierInvoiceId: input.supplierInvoiceId,
    requestedByUserId: input.requestedByUserId,
    requestedByName: input.requestedByName,
    requestedByRole: input.requestedByRole,
    createdAt: new Date().toISOString(),
  };
  data.clientInformationRequests.push(req);
  const ctx = tenantContext();
  logAudit("anvandare", "kundunderlag_begart", message, {
    targetType: input.expenseId ? "utgift" : "underlag",
    targetId: input.expenseId ?? req.id,
  });
  const last = data.auditTrail[data.auditTrail.length - 1];
  if (last) {
    last.actorUserId = ctx?.userId ?? input.requestedByUserId;
    last.actorRole = input.requestedByRole;
  }
  save();
  return req;
}

export function resolveClientRequestsForExpense(expenseId: string, byUserId?: string): number {
  const data = db();
  const list = data.clientInformationRequests ?? [];
  const now = new Date().toISOString();
  let n = 0;
  for (const req of list) {
    if (req.resolvedAt) continue;
    if (req.expenseId !== expenseId) continue;
    req.resolvedAt = now;
    req.resolvedByUserId = byUserId;
    n += 1;
    logAudit("anvandare", "kundunderlag_lost", req.message, {
      targetType: "utgift",
      targetId: expenseId,
    });
  }
  if (n) save();
  return n;
}

export function resolveClientRequest(id: string, byUserId?: string): ClientInformationRequest | null {
  const req = clientInformationRequests().find((r) => r.id === id);
  if (!req || req.resolvedAt) return req ?? null;
  req.resolvedAt = new Date().toISOString();
  req.resolvedByUserId = byUserId;
  logAudit("anvandare", "kundunderlag_lost", req.message, {
    targetType: "underlag",
    targetId: req.id,
  });
  save();
  return req;
}
