import { db } from "../store";
import { uid } from "../ids";
import type { ActivityEvent } from "../types";

/**
 * Tak för händelseloggen. Varje save() serialiserar hela databasen till disk,
 * så en obegränsad logg gör varje mutation långsammare för alltid. Loggen är
 * ett UI-flöde – bokföringens audit trail (auditTrail) berörs inte och capas
 * aldrig.
 */
const ACTIVITY_CAP = 2000;

export function logActivity(
  text: string,
  opts: { customerId?: string; entity?: ActivityEvent["entity"]; createdBy?: ActivityEvent["createdBy"] } = {}
): void {
  const activity = db().activity;
  activity.unshift({
    id: uid(),
    at: new Date().toISOString(),
    text,
    customerId: opts.customerId,
    entity: opts.entity,
    createdBy: opts.createdBy,
  });
  if (activity.length > ACTIVITY_CAP) activity.length = ACTIVITY_CAP;
}

export function recentActivity(limit = 8): ActivityEvent[] {
  return [...db().activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
