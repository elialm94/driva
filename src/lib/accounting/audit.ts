import { db } from "../store";
import { uid } from "../ids";
import type { AuditAction, AuditEvent } from "../types";

/**
 * Audit trail för bokföringen: vem (användare/assistent/system) gjorde vad, när.
 * Skiljer sig från aktivitetsflödet (services/activity.ts) som är berättande UI –
 * audit trail är strukturerad och rensas aldrig.
 */
export function logAudit(
  actor: AuditEvent["actor"],
  action: AuditAction,
  details: string,
  target?: { targetType?: string; targetId?: string }
): AuditEvent {
  const event: AuditEvent = {
    id: uid(),
    at: new Date().toISOString(),
    actor,
    action,
    details,
    targetType: target?.targetType,
    targetId: target?.targetId,
  };
  db().auditTrail.push(event);
  return event;
}

export function auditTrail(filter?: { action?: AuditAction; targetId?: string }): AuditEvent[] {
  let events = db().auditTrail;
  if (filter?.action) events = events.filter((e) => e.action === filter.action);
  if (filter?.targetId) events = events.filter((e) => e.targetId === filter.targetId);
  return [...events].sort((a, b) => b.at.localeCompare(a.at));
}
