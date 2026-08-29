/**
 * Per-request tenantstate för SIDORENDERINGAR i Supabase-läge.
 *
 * Problemet: en sida är inte en enda funktionskropp – Next renderar nästlade
 * serverkomponenter EFTER att sidans funktion returnerat, så AsyncLocalStorage
 * (som bär tenantkontexten i server actions) täcker inte JSX-trädet.
 *
 * Lösningen: React cache() ger en per-request-minnescell i RSC-rendern.
 * Sidan laddar företagets state EN gång (ensurePageBusiness i sessions-
 * modulen), och db() i store.ts läser cellen synkront – även från nästlade
 * serverkomponenter i samma request.
 *
 * Utanför en RSC-request (tester, route handlers, scripts) memoiserar cache()
 * inte – cellen är alltid tom och db() faller vidare till ALS/JSON-vägarna.
 * Route handlers och server actions ska därför alltid använda withBusiness/
 * withPublicBusiness, aldrig den här cellen.
 */
import { cache } from "react";
import type { DB } from "../types";

interface RequestSlot {
  state: DB | null;
  businessId: string | null;
}

export const requestSlot = cache((): RequestSlot => ({ state: null, businessId: null }));

/** Synkron läsning av sidans tenantstate, eller null utanför en laddad sida. */
export function requestTenantState(): DB | null {
  try {
    return requestSlot().state;
  } catch {
    // cache() utanför React-render kan sakna requestkontext – behandla som tom.
    return null;
  }
}
