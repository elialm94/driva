/**
 * Lagringsläge och miljökontrakt.
 *
 * Två lägen:
 *   "supabase" – Postgres via Supabase. Kräver miljövariablerna nedan.
 *   "json"     – lokal JSON-fil/in-memory. ENDAST för utveckling och tester.
 *
 * Produktionsregeln är absolut: saknas Supabase-miljön i produktion stannar
 * appen med ett tydligt fel vid första dataåtkomsten. Det finns INGEN tyst
 * fallback till demo-läge i produktion.
 */

export type StorageMode = "supabase" | "json";

export interface SupabaseEnv {
  /** Publik projekt-URL (https://<ref>.supabase.co). Även till klienten. */
  url: string;
  /** Publik nyckel (anon/publishable). Även till klienten. */
  anonKey: string;
  /** Server-only: service role-nyckeln. Får ALDRIG nå klientbundlar. */
  serviceRoleKey: string | undefined;
  /** Server-only: direkt Postgres-anslutning (Supavisor-pooler eller direkt). */
  dbUrl: string;
}

function trimmed(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

export function supabaseUrl(): string | undefined {
  return trimmed("NEXT_PUBLIC_SUPABASE_URL");
}

export function supabaseAnonKey(): string | undefined {
  // Nya projekt använder "publishable key", äldre "anon key" – båda accepteras.
  return trimmed("NEXT_PUBLIC_SUPABASE_ANON_KEY") ?? trimmed("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
}

export function supabaseServiceRoleKey(): string | undefined {
  return trimmed("SUPABASE_SERVICE_ROLE_KEY");
}

export function supabaseDbUrl(): string | undefined {
  return trimmed("SUPABASE_DB_URL") ?? trimmed("DATABASE_URL");
}

/** Komplett Supabase-miljö? (Storage/Auth-nycklar + databas-URL.) */
export function hasSupabaseEnv(): boolean {
  return Boolean(supabaseUrl() && supabaseAnonKey() && supabaseDbUrl());
}

export function supabaseEnv(): SupabaseEnv {
  const url = supabaseUrl();
  const anonKey = supabaseAnonKey();
  const dbUrl = supabaseDbUrl();
  if (!url || !anonKey || !dbUrl) {
    throw new Error(missingEnvMessage());
  }
  return { url, anonKey, serviceRoleKey: supabaseServiceRoleKey(), dbUrl };
}

export function missingEnvMessage(): string {
  const missing = [
    !supabaseUrl() && "NEXT_PUBLIC_SUPABASE_URL",
    !supabaseAnonKey() && "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    !supabaseDbUrl() && "SUPABASE_DB_URL",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    `Supabase-miljön saknas (${missing}). ` +
    `I produktion kör Driva aldrig mot demo-lagret – sätt miljövariablerna enligt README-avsnittet "Supabase setup". ` +
    `(Supabase environment missing – production never falls back to the local JSON store.)`
  );
}

let warnedJsonMode = false;

/**
 * Aktivt lagringsläge.
 *   * DRIVA_TEST=1 → json (in-memory) – domänsviten kör utan extern miljö.
 *   * Komplett Supabase-miljö → supabase.
 *   * Annars: dev → json (med engångsvarning), produktion → HÅRT FEL.
 */
export function storageMode(): StorageMode {
  if (process.env.DRIVA_TEST === "1") return "json";
  if (process.env.DRIVA_STORAGE === "json") {
    if (process.env.NODE_ENV === "production") throw new Error(missingEnvMessage());
    return "json";
  }
  if (hasSupabaseEnv()) return "supabase";
  if (process.env.NODE_ENV === "production") {
    throw new Error(missingEnvMessage());
  }
  if (!warnedJsonMode && process.env.NODE_ENV !== "test") {
    warnedJsonMode = true;
    console.info(
      "[driva:storage] Ingen Supabase-miljö hittades – kör mot lokal JSON-lagring (.data/db.json). Endast för utveckling."
    );
  }
  return "json";
}

export function isSupabaseMode(): boolean {
  return storageMode() === "supabase";
}
