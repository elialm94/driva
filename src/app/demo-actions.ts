"use server";

/**
 * Demosessionens livscykel: starta från /demo, avsluta till /login,
 * eller avsluta och gå vidare till kontoskapande.
 *
 * Starten är den enda publika vägen in. I produktion skapas en isolerad
 * kopia av exempeldatat per besökare – ingen Supabase-inloggning, inget
 * konto, ingen onboarding. JSON-läget (lokal utveckling) är redan demon.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { BUSINESS_COOKIE, WORKSPACE_COOKIE, getSessionUser } from "@/lib/auth/session";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  clientIpFrom,
  demoCookieValueNow,
  demoSessionIdFromCookie,
  demoSessionMaxAgeSeconds,
  isDemoUserEmail,
  rateLimitDemoStart,
  readActiveDemoSessionId,
} from "@/lib/auth/demo-session";
import {
  createDemoSessionStore,
  deleteDemoSessionStore,
} from "@/lib/storage/demo-session-store";

export interface DemoStartState {
  error?: string;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

async function setDemoSessionCookie(value: string): Promise<void> {
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, value, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    maxAge: demoSessionMaxAgeSeconds(),
  });
}

async function clearDemoCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of [DEMO_SESSION_COOKIE, DEMO_ACTOR_COOKIE, WORKSPACE_COOKIE, BUSINESS_COOKIE]) {
    jar.set(name, "", { path: "/", maxAge: 0, sameSite: "lax", secure: secureCookies() });
    jar.delete(name);
  }
}

function supabaseEnabled(): boolean {
  try {
    return isSupabaseMode();
  } catch {
    return false;
  }
}

/** Öppna demon: ny isolerad session från känt seed – rakt in i appen. */
export async function startDemoAction(_prev: DemoStartState, _formData: FormData): Promise<DemoStartState> {
  // JSON-läget (lokal utveckling) ÄR demon – rakt in i appen.
  if (!supabaseEnabled()) redirect("/");

  const ip = clientIpFrom(await headers());
  if (!rateLimitDemoStart(ip)) {
    return { error: "Många öppnar demon just nu. Vänta en liten stund och försök igen." };
  }

  const value = demoCookieValueNow();
  const sessionId = demoSessionIdFromCookie(value);
  if (!sessionId) {
    return { error: "Demon kunde inte öppnas just nu. Försök igen om en stund." };
  }

  try {
    const expires = Number(value.split(".")[0]);
    await createDemoSessionStore(sessionId, expires);
  } catch (err) {
    console.error(`[driva:demo] kunde inte skapa demosession: ${err instanceof Error ? err.message : err}`);
    return { error: "Demon kunde inte öppnas just nu. Försök igen om en stund." };
  }

  await setDemoSessionCookie(value);
  redirect("/");
}

/** Avsluta demo: släpp den här besökarens session → /login. */
export async function endDemoAction(): Promise<void> {
  await endDemoSession();
  redirect("/login");
}

/** "Skapa eget konto" i demon: avsluta demosessionen → registreringsläget. */
export async function endDemoToSignupAction(): Promise<void> {
  await endDemoSession();
  redirect("/login?skapa=1");
}

async function endDemoSession(): Promise<void> {
  const sessionId = await readActiveDemoSessionId();
  if (sessionId) await deleteDemoSessionStore(sessionId);

  if (isSupabaseMode()) {
    const user = await getSessionUser();
    if (user && isDemoUserEmail(user.email)) {
      const supabase = await createSupabaseServerClient();
      // scope "local": släpp bara DENNA besökares tokens om en äldre
      // delad demo-användare fortfarande sitter i kakorna.
      await supabase.auth.signOut({ scope: "local" });
    }
  }
  await clearDemoCookies();
  revalidatePath("/", "layout");
}
