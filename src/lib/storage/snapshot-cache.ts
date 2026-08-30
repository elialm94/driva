/**
 * Versionsnycklad snapshot-cache för tenanttillstånd (per serverinstans).
 *
 * Problemet: varje sidladdning i Supabase-läge laddade hela företagets
 * tillstånd (~42 SQL-frågor + full datamängd + mappning). Stockholm↔Stockholm
 * är snabbt, men arbetet är onödigt när ingenting ändrats.
 *
 * Lösningen: businesses.state_version bumpas av VARJE commit (CAS:en i
 * commit.ts är den enda skrivaren). Därför räcker EN billig fråga
 * (`select state_version …`) för att veta om det cachade tillståndet
 * fortfarande är aktuellt:
 *
 *   * träff  → returnera en strukturell kopia av cachen (0 tunga frågor)
 *   * miss   → full laddning, uppdatera cachen
 *
 * Korrekthetsregler (viktigare än fart):
 *   * Anropare får ALLTID en egen djupkopia – cachen delas aldrig muterbart
 *     mellan förfrågningar.
 *   * Efter en lyckad commit uppdateras cachen med den NYA versionen från
 *     CAS-RETURNING – aldrig en gissning.
 *   * Skrivvägar utanför appens commit (manuella SQL-ändringar) bumpar inte
 *     versionen; TTL:en nedan begränsar den teoretiska staleness-risken.
 *   * Cachen är per instans. Andra instansers commits upptäcks alltid via
 *     versionskontrollen (den går mot databasen varje gång).
 */
import type { DB } from "@/lib/types";
import type { SqlClient } from "./executor";
import { cloneState } from "./context";

interface CacheEntry {
  state: DB;
  stateVersion: number;
  cachedAt: number;
}

/**
 * Max antal företag i cachen (LRU). Dimensionerad för redovisningsytan:
 * portföljvyn läser ALLA klienters tillstånd, så gränsen måste rymma en
 * normal konsultportfölj utan att tumma (~78 kB JSON per demoklient).
 */
const MAX_ENTRIES = 64;
/** Säkerhetsventil: full omläsning efter TTL även om versionen matchar. */
const TTL_MS = 5 * 60 * 1000;

const entries = new Map<string, CacheEntry>();
let enabledOverride: boolean | null = null;

/** Testkrok: slå av/på cachen explicit (t.ex. i valideringsskript). */
export function configureSnapshotCache(opts: { enabled: boolean | null }): void {
  enabledOverride = opts.enabled;
  if (opts.enabled === false) entries.clear();
}

export function snapshotCacheEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride;
  return process.env.DRIVA_SNAPSHOT_CACHE !== "0";
}

/**
 * Hämta aktuell state_version med en enda billig fråga. Körs utanför
 * transaktion – samma åtkomstväg som membershipsForUser.
 */
async function currentVersion(client: SqlClient, businessId: string): Promise<number | null> {
  const rows = await client.query(`select state_version from public.businesses where id = $1`, [businessId]);
  const v = rows[0]?.state_version;
  return v == null ? null : Number(v);
}

/**
 * Returnera en färsk kopia av tillståndet om cachen matchar databasens
 * version, annars null (anroparen gör en full laddning).
 */
export async function cachedStateIfFresh(
  client: SqlClient,
  businessId: string
): Promise<{ state: DB; stateVersion: number } | null> {
  if (!snapshotCacheEnabled()) return null;
  const entry = entries.get(businessId);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > TTL_MS) {
    entries.delete(businessId);
    return null;
  }
  const version = await currentVersion(client, businessId);
  if (version === null || version !== entry.stateVersion) {
    entries.delete(businessId);
    return null;
  }
  // LRU-touch.
  entries.delete(businessId);
  entries.set(businessId, entry);
  return { state: cloneState(entry.state), stateVersion: entry.stateVersion };
}

/** Lägg in ett nyladdat/nycommittat tillstånd. Cachen äger sin egen kopia. */
export function putSnapshot(businessId: string, state: DB, stateVersion: number): void {
  if (!snapshotCacheEnabled()) return;
  entries.delete(businessId);
  entries.set(businessId, { state: cloneState(state), stateVersion, cachedAt: Date.now() });
  while (entries.size > MAX_ENTRIES) {
    const oldest = entries.keys().next().value;
    if (oldest === undefined) break;
    entries.delete(oldest);
  }
}

/** Kasta cacheposten (t.ex. vid commit-konflikt eller osäkert läge). */
export function invalidateSnapshot(businessId: string): void {
  entries.delete(businessId);
}

/** Töm hela cachen (klientbyte i tester – kan peka på en annan databas). */
export function clearSnapshotCache(): void {
  entries.clear();
}
