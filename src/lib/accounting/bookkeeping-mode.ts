import { db, save } from "../store";
import { currentActor } from "../collaboration/actor";
import { employees } from "./payroll";
import { parseBookkeepingMode, type BookkeepingMode } from "./bookkeeping-mode-keys";

export type { BookkeepingMode } from "./bookkeeping-mode-keys";
export { simpleBookkeepingKeys } from "./bookkeeping-mode-keys";

/**
 * Företagets äldre värde, innan läget flyttade per användare. Används som
 * startvärde för ägaren och som fallback när användaren inte valt själv.
 */
export function companyBookkeepingMode(): BookkeepingMode {
  return db().meta.bookkeepingMode === "avancerat" ? "avancerat" : "enkelt";
}

/** @deprecated Använd bookkeepingModeForUser. Behålls som fallback utan aktör. */
export function bookkeepingMode(): BookkeepingMode {
  const userId = currentActor()?.userId;
  return userId ? bookkeepingModeForUser(userId) : companyBookkeepingMode();
}

export function bookkeepingModeForUser(userId: string): BookkeepingMode {
  const stored = parseBookkeepingMode(db().meta.bookkeepingModeByUser?.[userId]);
  if (stored) return stored;
  return companyBookkeepingMode();
}

/**
 * Sparar läget per användare. Första skrivningen för ägaren tar med det
 * gamla företagsvärdet som redan är fallback, så befintliga bolag inte
 * tappar avancerat.
 */
export function setBookkeepingModeForUser(userId: string, mode: BookkeepingMode): BookkeepingMode {
  const data = db();
  const byUser = { ...(data.meta.bookkeepingModeByUser ?? {}) };
  if (!byUser[userId] && data.meta.bookkeepingMode && currentActor()?.role === "agare") {
    byUser[userId] = companyBookkeepingMode();
  }
  byUser[userId] = mode;
  data.meta.bookkeepingModeByUser = byUser;
  save();
  return mode;
}

export function bookkeepingHasPayroll(): boolean {
  return employees().length > 0;
}
