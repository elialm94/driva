import { db } from "../store";
import { uid } from "../ids";
import type { ActivityEvent } from "../types";

export function logActivity(
  text: string,
  opts: { customerId?: string; entity?: ActivityEvent["entity"]; createdBy?: ActivityEvent["createdBy"] } = {}
): void {
  db().activity.unshift({
    id: uid(),
    at: new Date().toISOString(),
    text,
    customerId: opts.customerId,
    entity: opts.entity,
    createdBy: opts.createdBy,
  });
}

export function recentActivity(limit = 8): ActivityEvent[] {
  return [...db().activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
