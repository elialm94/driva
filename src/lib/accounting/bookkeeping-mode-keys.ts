export type BookkeepingMode = "enkelt" | "avancerat";

/**
 * Enkelt/avancerat är en vy-inställning för flikraden – inte bokföringsdata.
 * Den bor därför i en cookie som klienten själv skriver: växlingen byter
 * chrome direkt, utan serveråtgärd, utan revalidering och utan att bumpa
 * tenantens state_version (en skrivning slår ut snapshot-cachen och gör nästa
 * navigering till en kall tillståndsladdning).
 */
export const BOKFORING_MODE_COOKIE = "driva_bokforing_lage";

/** Ett år: läget ska sitta kvar mellan besök i samma webbläsare. */
export const BOKFORING_MODE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/** Okänt/saknat värde ⇒ null, så att anroparen kan falla tillbaka på enkelt. */
export function parseBookkeepingMode(raw: string | undefined | null): BookkeepingMode | null {
  return raw === "enkelt" || raw === "avancerat" ? raw : null;
}

const SIMPLE_KEYS: string[] = ["oversikt", "moms", "skattekonto"];

/** Flikar som syns i enkelt läge. Lön och bokslut bara när de behövs. */
export function simpleBookkeepingKeys(opts: { hasPayroll: boolean; showYearEnd: boolean }): string[] {
  const keys = [...SIMPLE_KEYS];
  if (opts.hasPayroll) keys.push("lon");
  if (opts.showYearEnd) keys.push("bokslut");
  return keys;
}
