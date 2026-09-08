import { db, save } from "../store";
import { employees } from "./payroll";

export type BookkeepingMode = "enkelt" | "avancerat";

const SIMPLE_KEYS: string[] = ["oversikt", "moms", "skattekonto"];

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

/** Flikar som syns i enkelt läge. Lön och bokslut bara när de behövs. */
export function simpleBookkeepingKeys(opts: { hasPayroll: boolean; showYearEnd: boolean }): string[] {
  const keys = [...SIMPLE_KEYS];
  if (opts.hasPayroll) keys.push("lon");
  if (opts.showYearEnd) keys.push("bokslut");
  return keys;
}
