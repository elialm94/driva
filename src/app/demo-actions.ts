"use server";

/**
 * Demosessionens livscykel: starta från /demo, avsluta till /login,
 * eller avsluta och gå vidare till kontoskapande.
 *
 * Starten är den ENDA publika vägen in: en riktig Supabase-inloggning görs på
 * servern med demo-uppgifterna ur servermiljön (aldrig i klientbundeln), och
 * sessionen märks med en tidsbegränsad demo-cookie som proxyn upprätthåller.
 * Ingen auth hoppas över – demosessionen är en vanlig, begränsad användare.
 */
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import {
  BUSINESS_COOKIE,
  WORKSPACE_COOKIE,
  getSessionUser,
} from "@/lib/auth/session";
import {
  DEMO_ACTOR_COOKIE,
  DEMO_SESSION_COOKIE,
  clientIpFrom,
  demoCookieValueNow,
  demoSessionMaxAgeSeconds,
  demoUserEmail,
  demoUserPassword,
  isDemoLoginConfigured,
  isDemoUserEmail,
  rateLimitDemoStart,
} from "@/lib/auth/demo-session";

export interface DemoStartState {
  error?: string;
}

const DEMO_UNAVAILABLE =
  "Demon är inte tillgänglig i den här miljön ännu. Logga in eller skapa ett konto i stället.";

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

async function setDemoSessionCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(DEMO_SESSION_COOKIE, demoCookieValueNow(), {
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

/** Öppna demon: serverinloggning som demo-användaren + tidsbegränsad markering. */
export async function startDemoAction(_prev: DemoStartState, _formData: FormData): Promise<DemoStartState> {
  // JSON-läget (lokal utveckling) ÄR demon – rakt in i appen.
  if (!isSupabaseMode()) redirect("/");
  if (!isDemoLoginConfigured()) return { error: DEMO_UNAVAILABLE };

  const ip = clientIpFrom(await headers());
  if (!rateLimitDemoStart(ip)) {
    return { error: "Många öppnar demon just nu. Vänta en liten stund och försök igen." };
  }

  const supabase = await createSupabaseServerClient();
  // En redan inloggad användare som uttryckligen öppnar demon byter session –
  // samma semantik som att logga in med ett annat konto. Avsluta demo → /login.
  const { error } = await supabase.auth.signInWithPassword({
    email: demoUserEmail()!,
    password: demoUserPassword()!,
  });
  if (error) {
    console.error(`[driva:demo] demoinloggning misslyckades: ${error.code ?? error.message}`);
    return { error: "Demon kunde inte öppnas just nu. Försök igen om en stund." };
  }
  await setDemoSessionCookie();
  redirect("/");
}

/** Avsluta demo: släpp demosessionen (endast den – scope local) → /login. */
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
  if (!isSupabaseMode()) {
    // JSON-läget har inga sessioner – bara ev. lokala demokakor städas.
    await clearDemoCookies();
    revalidatePath("/", "layout");
    return;
  }
  const user = await getSessionUser();
  if (user && isDemoUserEmail(user.email)) {
    const supabase = await createSupabaseServerClient();
    // scope "local": släpp bara DENNA besökares tokens. Demo-användaren delas
    // av alla demosessioner – en global signOut skulle logga ut alla andra.
    await supabase.auth.signOut({ scope: "local" });
  }
  await clearDemoCookies();
  revalidatePath("/", "layout");
}
