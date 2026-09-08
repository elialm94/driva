import { db, save } from "../store";
import { employees } from "./payroll";
import type { BookkeepingMode } from "./bookkeeping-mode-keys";

export type { BookkeepingMode } from "./bookkeeping-mode-keys";
export { simpleBookkeepingKeys } from "./bookkeeping-mode-keys";

/** Saknas inställning = enkelt – hantverkaren ska inte möta huvudboken först. */
export function bookkeepingMode(): BookkeepingMode {
  return db().meta.bookkeepingMode === "avancerat" ? "avancerat" : "enkelt";
}

export function setBookkeepingMode(mode: BookkeepingMode): BookkeepingMode {
  if (mode !== "enkelt" && mode !== "avancerat") {
    throw new Error("Okänt bokföringsläge.");
  }
  if (db().meta.bookkeepingMode === mode) return mode;
  db().meta.bookkeepingMode = mode;
  save();
  return mode;
}

export function bookkeepingHasPayroll(): boolean {
  return employees().length > 0;
}
