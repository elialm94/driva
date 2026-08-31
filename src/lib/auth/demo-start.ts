/**
 * Start av en isolerad demosession – anropas ENDAST från /demo-routens
 * GET-hanterare (cookies() är skrivbar där, precis som i server actions).
 *
 *   1. Riktig Supabase-inloggning som demo-användaren på servern
 *      (uppgifterna finns bara i servermiljön – aldrig i klientbundeln).
 *   2. Eget demoföretag provisioneras från exempeldatat; sessionens hemliga
 *      token sätts i demo-cookien och SHA-256(token) lagras på företaget.
 *   3. Opportunistisk städning av utgångna demosessioner (cron är
 *      huvudvägen, det här håller nere eftersläpningen).
 */
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  demoCookieValueFor,
  demoSessionMaxAgeSeconds,
  demoTokenFromCookieValue,
  demoTokenHash,
  demoUserEmail,
  demoUserPassword,
  isDemoUserEmail,
  newDemoSessionToken,
  rateLimitDemoStart,
} from "@/lib/auth/demo-session";
import { BUSINESS_COOKIE, WORKSPACE_COOKIE } from "@/lib/auth/session";
import { cleanupExpiredDemoBusinesses, demoBusinessIdForTokenHash } from "@/lib/storage/adapter-supabase";
import { provisionDemoSessionBusiness } from "@/lib/storage/demo-reset";

export type DemoStartResult =
  | { ok: true; reused: boolean }
  | { ok: false; reason: "rate_limited" | "failed" };

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Har besökaren redan en levande demosession? (Demo-inloggad + cookie-token
 * som mappar till ett olöpt demoföretag.) Då återanvänds den – en reload
 * eller ett nytt klick på "Se demo" ska inte provisionera ett nytt företag.
 */
export async function activeDemoSessionExists(): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const { data } = await supabase.auth.getClaims();
  if (!data?.claims?.sub || !isDemoUserEmail(String(data.claims.email ?? ""))) return false;
  const jar = await cookies();
  const token = demoTokenFromCookieValue(jar.get(DEMO_SESSION_COOKIE)?.value);
  if (!token) return false;
  return Boolean(await demoBusinessIdForTokenHash(demoTokenHash(token)));
}

/** Starta (eller återanvänd) demosessionen. Sätter alla kakor vid framgång. */
export async function startDemoSession(clientIp: string): Promise<DemoStartResult> {
  if (await activeDemoSessionExists()) return { ok: true, reused: true };

  if (!rateLimitDemoStart(clientIp)) return { ok: false, reason: "rate_limited" };

  const supabase = await createSupabaseServerClient();
  // En redan inloggad användare som uttryckligen öppnar demon byter session –
  // samma semantik som att logga in med ett annat konto.
  const { data, error } = await supabase.auth.signInWithPassword({
    email: demoUserEmail()!,
    password: demoUserPassword()!,
  });
  if (error || !data.user) {
    console.error(`[driva:demo] demoinloggning misslyckades: ${error?.code ?? error?.message ?? "okänt"}`);
    return { ok: false, reason: "failed" };
  }

  // Cron är huvudstädningen; det här tar udden av eftersläpning utan att
  // någonsin få blockera en demostart.
  try {
    await cleanupExpiredDemoBusinesses(5);
  } catch (e) {
    console.error(`[driva:demo] opportunistisk städning misslyckades: ${e instanceof Error ? e.message : e}`);
  }

  const token = newDemoSessionToken();
  const expiresAt = new Date(Date.now() + demoSessionMaxAgeSeconds() * 1000).toISOString();
  try {
    await provisionDemoSessionBusiness({
      tokenHash: demoTokenHash(token),
      expiresAt,
      userId: data.user.id,
    });
  } catch (e) {
    console.error(`[driva:demo] provisionering misslyckades: ${e instanceof Error ? e.message : e}`);
    // Släpp den halvstartade demoinloggningen (endast denna besökares tokens).
    await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    return { ok: false, reason: "failed" };
  }

  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, demoCookieValueFor(token), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: demoSessionMaxAgeSeconds(),
  });
  // Ingen kvarhängande arbetsyta/företagsval/aktörsbyte från en tidigare session.
  for (const name of [DEMO_ACTOR_COOKIE, WORKSPACE_COOKIE, BUSINESS_COOKIE]) {
    jar.delete(name);
  }
  return { ok: true, reused: false };
}
