import { db } from "../store";
import { employees } from "./payroll";
import type { BookkeepingMode } from "./bookkeeping-mode-keys";

export type { BookkeepingMode } from "./bookkeeping-mode-keys";
export { simpleBookkeepingKeys } from "./bookkeeping-mode-keys";

/**
 * Läget som företaget sparade innan vyinställningen flyttade till cookien
 * (BOKFORING_MODE_COOKIE). Läses bara som fallback när cookien saknas –
 * saknas båda gäller enkelt: hantverkaren ska inte möta huvudboken först.
 */
export function bookkeepingMode(): BookkeepingMode {
  return db().meta.bookkeepingMode === "avancerat" ? "avancerat" : "enkelt";
}

export function bookkeepingHasPayroll(): boolean {
  return employees().length > 0;
}
