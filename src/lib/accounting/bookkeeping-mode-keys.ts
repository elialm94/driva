export type BookkeepingMode = "enkelt" | "avancerat";

const SIMPLE_KEYS: string[] = ["oversikt", "moms", "skattekonto"];

/** Flikar som syns i enkelt läge. Lön och bokslut bara när de behövs. */
export function simpleBookkeepingKeys(opts: { hasPayroll: boolean; showYearEnd: boolean }): string[] {
  const keys = [...SIMPLE_KEYS];
  if (opts.hasPayroll) keys.push("lon");
  if (opts.showYearEnd) keys.push("bokslut");
  return keys;
}
