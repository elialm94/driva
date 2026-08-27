import { db, save } from "../store";
import { uid } from "../ids";
import type { DomainAuditAction, DomainAuditEvent } from "../types";

export function logDomainAudit(
  action: DomainAuditAction,
  details: string,
  opts: { actor?: DomainAuditEvent["actor"]; domainId?: string; hostname?: string } = {},
): DomainAuditEvent {
  const event: DomainAuditEvent = {
    id: uid(),
    at: new Date().toISOString(),
    actor: opts.actor ?? "system",
    action,
    domainId: opts.domainId,
    hostname: opts.hostname,
    details,
  };
  db().domainAudit.push(event);
  save();
  return event;
}

export function domainAuditFor(domainId: string): DomainAuditEvent[] {
  return db()
    .domainAudit.filter((e) => e.domainId === domainId)
    .sort((a, b) => b.at.localeCompare(a.at));
}
