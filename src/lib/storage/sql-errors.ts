/** Postgres: relation does not exist */
export function isUndefinedRelation(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42P01") return true;
  return /relation ".+" does not exist/i.test(e.message ?? "");
}

/** Postgres: column does not exist */
export function isUndefinedColumn(err: unknown): boolean {
  const e = err as { code?: string; message?: string } | null;
  if (!e) return false;
  if (e.code === "42703") return true;
  return /column ".+" does not exist/i.test(e.message ?? "");
}

const STORAGE_SAVE_FAILED = "Kunde inte spara ändringen. Försök igen.";

function looksLikeEngineError(message: string): boolean {
  return (
    /column ".+" of relation/i.test(message) ||
    /does not exist/i.test(message) ||
    /relation ".+"/i.test(message) ||
    /syntax error/i.test(message) ||
    /violates .+ constraint/i.test(message) ||
    /\bPGRST/i.test(message) ||
    /\bpostgres\b/i.test(message) ||
    /^[0-9A-Z]{5}:/.test(message)
  );
}

/**
 * End-user-text. Rå SQL/Postgres (t.ex. saknad websites.footer) läcker aldrig.
 * Domänfel på svenska lämnas orörda.
 */
export function userFacingStorageError(err: unknown, fallback = STORAGE_SAVE_FAILED): string {
  if (isUndefinedColumn(err) || isUndefinedRelation(err)) return fallback;
  const message = err instanceof Error ? err.message.trim() : "";
  if (!message) return fallback;
  if (looksLikeEngineError(message)) return fallback;
  return message;
}
