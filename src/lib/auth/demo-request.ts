/**
 * Demosessionens request-sida: cookie-läsning och livscykel (starta,
 * återställa, avsluta). Ersätter den tidigare Supabase-provisioneringen –
 * ingen anonym inloggning, inga databasrader: en httpOnly-cookie pekar ut
 * besökarens egen JSON-fil (se storage/demo-session-store.ts).
 *
 * Identifieraren är sessions-id:t i cookien (kryptografiskt slumpat,
 * httpOnly). Ett klientpåstått id kan bara nå SIN egen demofil – aldrig en
 * annan besökares fil och aldrig Supabase-data, eftersom demorequests
 * uttryckligen kör mot fil-storen i stället för databasen.
 */
import { cookies } from "next/headers";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  demoCookieValueNow,
  demoSessionIdFromCookie,
  demoSessionMaxAgeSeconds,
  newDemoSessionId,
} from "@/lib/auth/demo-session";
import {
  deleteDemoSessionState,
  ensureDemoSessionState,
} from "@/lib/storage/demo-session-store";

/** Sessionens tenant-id: unikt per besökare, kolliderar aldrig med riktiga uuid:n. */
export function demoBusinessIdFor(sessionId: string): string {
  return `demo-${sessionId}`;
}

/** Sessionens aktörs-id (aktivitetslogg m.m.) – unikt per besökare. */
export function demoUserIdFor(sessionId: string): string {
  return `demo-user-${sessionId}`;
}

/** Aktivt demosessions-id ur requestens cookies, annars null. */
export async function readDemoSessionId(): Promise<string | null> {
  try {
    const jar = await cookies();
    return demoSessionIdFromCookie(jar.get(DEMO_SESSION_COOKIE)?.value);
  } catch {
    // Utanför requestkontext (skript/tester) finns ingen demosession.
    return null;
  }
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

export async function setDemoSessionCookie(sessionId: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, demoCookieValueNow(sessionId), {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: demoSessionMaxAgeSeconds(),
  });
}

export async function clearDemoCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of [DEMO_SESSION_COOKIE, DEMO_ACTOR_COOKIE]) {
    jar.set(name, "", { path: "/", maxAge: 0, sameSite: "lax", secure: secureCookies() });
    jar.delete(name);
  }
}

/**
 * Starta en färsk demosession: nytt id, klona seedet till sessionens fil,
 * sätt cookien. Anropas ENDAST från /demo-routen (efter rate limit-kontrollen).
 */
export async function startDemoSession(): Promise<string> {
  const sessionId = newDemoSessionId();
  await ensureDemoSessionState(sessionId);
  await setDemoSessionCookie(sessionId);
  return sessionId;
}

/**
 * Avsluta besökarens demosession: släng sessionens JSON-fil och rensa
 * demokakorna. Delas av demo-åtgärderna och logga ut-flödet. Rör aldrig
 * Supabase – demon bor inte där.
 */
export async function endDemoSession(): Promise<void> {
  const sessionId = await readDemoSessionId();
  if (sessionId) await deleteDemoSessionState(sessionId);
  await clearDemoCookies();
}
