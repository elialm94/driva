/**
 * Request-skopad tenantkontext (AsyncLocalStorage).
 *
 * I Supabase-läge laddas företagets tillstånd till ett DB-objekt per request.
 * Den synkrona domänlogiken arbetar oförändrad mot objektet via db()/save().
 * Vid kontextens slut diffas tillståndet mot baslinjen och skrivs atomärt
 * i EN Postgres-transaktion (se commit.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { DB } from "@/lib/types";

export interface TenantContext {
  businessId: string;
  /** Autentiserad användare (auth.users.id). null för publika tokenflöden. */
  userId: string | null;
  /** Läskontexter får inte spara – save() kastar. */
  writable: boolean;
  /** Tillståndet domänkoden muterar. */
  state: DB;
  /** Djupfryst baslinje för diffning. */
  baseline: DB;
  /** state_version-raden vid inläsning (optimistisk låsning). */
  stateVersion: number;
  /** Sätts av save(). */
  dirty: boolean;
}

const als = new AsyncLocalStorage<TenantContext>();

export function tenantContext(): TenantContext | undefined {
  return als.getStore();
}

export function requireTenantContext(): TenantContext {
  const ctx = als.getStore();
  if (!ctx) {
    throw new Error(
      "Ingen tenantkontext. Databasåtkomst i Supabase-läge kräver att anropet sker inom runWithTenant()/withBusiness()."
    );
  }
  return ctx;
}

export function runInTenantContext<T>(ctx: TenantContext, fn: () => T): T {
  return als.run(ctx, fn);
}

/** Strukturell djupkopia – tillståndet är ren JSON (inga klasser/Date). */
export function cloneState(state: DB): DB {
  return structuredClone(state);
}
