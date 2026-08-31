/**
 * Provisionering av isolerade demosessioner (Supabase-läget).
 *
 * Varje besökare får en EGEN anonym Supabase-användare som äger ett EGET
 * demoföretag, seedat med Södermalms Snickeri AB:s exempeldata genom exakt
 * samma importväg som db:seed och demo-återställningen. Isoleringen är
 * därmed den vanliga tenantisoleringen (medlemskap + RLS) – ingen särskild
 * demoväg i auktoriseringen:
 *
 *   Browser A                              Browser B
 *   anonym användare A ─ ägare ─ demo A    anonym användare B ─ ägare ─ demo B
 *
 * A kan aldrig läsa B:s demoföretag av samma skäl som ett riktigt företag
 * aldrig kan läsa ett annat: inget medlemskap, ingen RLS-träff.
 *
 * Sessionens identifierare är Supabase-tokens i httpOnly-cookies
 * (kryptografiskt slumpade). Ett klientpåstått företags-id räcker aldrig:
 * varje läs/skriv auktoriseras mot medlemskapen på serversidan.
 */
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  BUSINESS_COOKIE,
  WORKSPACE_COOKIE,
  getSessionUser,
  isDemoSession,
} from "@/lib/auth/session";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  demoCookieValueNow,
  demoSessionMaxAgeSeconds,
} from "@/lib/auth/demo-session";
import { membershipsForUser, createBusinessWithOwner, sqlClient } from "@/lib/storage/adapter-supabase";
import { bindTransaction } from "@/lib/storage/load";
import { importStateIntoBusiness } from "@/lib/storage/import-state";
import { demoSeedFor } from "@/lib/storage/demo-reset";

export type DemoProvisionResult =
  | { ok: true }
  | { ok: false; reason: "unavailable" | "failed" };

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function setDemoSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, demoCookieValueNow(), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: demoSessionMaxAgeSeconds(),
  });
}

export async function clearDemoCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of [DEMO_SESSION_COOKIE, DEMO_ACTOR_COOKIE, WORKSPACE_COOKIE, BUSINESS_COOKIE]) {
    jar.set(name, "", { path: "/", maxAge: 0, sameSite: "lax", secure: secureCookies() });
    jar.delete(name);
  }
}

/**
 * Skapa en färsk demosession: anonym inloggning + eget demoföretag + seed.
 * Anropas ENDAST från /demo-routen (efter rate limit-kontrollen).
 */
export async function provisionDemoSession(): Promise<DemoProvisionResult> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    // Vanligaste orsaken: anonyma inloggningar är inte påslagna i projektet.
    console.error(`[driva:demo] anonym inloggning misslyckades: ${error?.code ?? error?.message ?? "okänt"}`);
    return { ok: false, reason: "unavailable" };
  }
  const userId = data.user.id;

  try {
    const expiresAt = new Date(Date.now() + demoSessionMaxAgeSeconds() * 1000).toISOString();
    const seedTemplate = demoSeedFor("mall");
    const businessId = await createBusinessWithOwner({
      userId,
      name: seedTemplate.settings.name,
      orgNumber: seedTemplate.settings.orgNumber,
      email: seedTemplate.settings.email,
      phone: seedTemplate.settings.phone,
      isDemo: true,
      demoExpiresAt: expiresAt,
    });
    await importStateIntoBusiness(businessId, userId, demoSeedFor(businessId));
  } catch (e) {
    // Halvprovisionerad demo får aldrig lämnas som aktiv session – släpp
    // besökarens tokens; företaget (om det hann skapas) städas av cleanup
    // när demo_expires_at passerats.
    console.error(`[driva:demo] provisionering misslyckades: ${e instanceof Error ? e.message : e}`);
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    await clearDemoCookies().catch(() => undefined);
    return { ok: false, reason: "failed" };
  }

  await setDemoSessionCookie();
  return { ok: true };
}

/** Har den (verifierade) användaren redan ett demoföretag? */
export async function hasDemoMembership(userId: string): Promise<boolean> {
  try {
    return (await membershipsForUser(userId)).length > 0;
  } catch {
    return false;
  }
}

/**
 * Avsluta besökarens demosession: markera demoföretaget för omedelbar
 * städning, släpp Supabase-tokens (endast DENNA besökares – scope local)
 * och rensa demokakorna. Delas av demo-åtgärderna och logga ut-flödet.
 */
export async function endDemoSession(): Promise<void> {
  if (!isSupabaseMode()) {
    // JSON-läget har inga sessioner – bara ev. lokala demokakor städas.
    await clearDemoCookies();
    return;
  }
  const user = await getSessionUser();
  if (user && (await isDemoSession())) {
    await expireDemoBusinessesNow(user.id);
    const supabase = await createSupabaseServerClient();
    await supabase.auth.signOut({ scope: "local" });
  }
  await clearDemoCookies();
}

/**
 * Bäst ansträngning: flytta demoföretagets utgångstid till nu så att nästa
 * cleanup-körning tar datat direkt i stället för att vänta ut livslängden.
 * Frystriggern tillåter bara tidigareläggning, och WHERE-villkoret gör att
 * riktiga företag aldrig berörs.
 */
async function expireDemoBusinessesNow(userId: string): Promise<void> {
  try {
    const memberships = await membershipsForUser(userId);
    const client = await sqlClient();
    for (const m of memberships) {
      await client.transaction(async (tx) => {
        await bindTransaction(tx, m.businessId);
        await tx.query(
          `update public.businesses
              set demo_expires_at = now()
            where id = $1 and is_demo and demo_expires_at is not null and demo_expires_at > now()`,
          [m.businessId]
        );
      });
    }
  } catch (e) {
    // Städningen tar företaget senast vid ordinarie utgångstid.
    console.warn(`[driva:demo] kunde inte tidigarelägga städning: ${e instanceof Error ? e.message : e}`);
  }
}
