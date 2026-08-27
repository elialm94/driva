import { db } from "../store";
import { uid } from "../ids";
import type { ActivityEvent } from "../types";

export function logActivity(
  text: string,
  opts: { customerId?: string; entity?: ActivityEvent["entity"] } = {}
): void {
  db().activity.unshift({
    id: uid(),
    at: new Date().toISOString(),
    text,
    customerId: opts.customerId,
    entity: opts.entity,
  });
}

export function recentActivity(limit = 8): ActivityEvent[] {
  return [...db().activity].sort((a, b) => b.at.localeCompare(a.at)).slice(0, limit);
}
