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
