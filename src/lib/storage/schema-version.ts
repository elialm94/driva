/**
 * Förväntad senaste migration (versionsprefixet i supabase/migrations).
 * Uppdateras när en ny migration läggs till; testet i schema-version.test.ts
 * jämför mot katalogen så att konstanten inte glöms. Systemvyn jämför
 * konstanten med supabase_migrations.schema_migrations i databasen och
 * visar "migrationer saknas" i stället för att gissa.
 */
export const EXPECTED_MIGRATION_VERSION = "20260913140000";

/** Plocka versionsprefixet ur ett migrationsfilnamn ("20260912150000_52_x.sql" → "20260912150000"). */
export function migrationVersionFromFilename(name: string): string | null {
  const m = /^(\d{14})_/.exec(name);
  return m ? m[1] : null;
}
