"use server";

/**
 * Demosessionens livscykel: avsluta till /login, eller avsluta och gå vidare
 * till kontoskapande. Själva STARTEN sker i /demo-routens GET-hanterare
 * (src/app/(auth)/demo/route.ts) – "Se demo" går direkt in i produkten.
 *
 * Demodata migreras aldrig till riktiga konton: att lämna demon släpper bara
 * sessionen; det isolerade demoföretaget städas bort när det löper ut.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { BUSINESS_COOKIE, WORKSPACE_COOKIE, getSessionUser } from "@/lib/auth/session";
import { DEMO_ACTOR_COOKIE, DEMO_SESSION_COOKIE, isDemoUserEmail } from "@/lib/auth/demo-session";

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

async function clearDemoCookies(): Promise<void> {
  const jar = await cookies();
  for (const name of [DEMO_SESSION_COOKIE, DEMO_ACTOR_COOKIE, WORKSPACE_COOKIE, BUSINESS_COOKIE]) {
    jar.set(name, "", { path: "/", maxAge: 0, sameSite: "lax", secure: secureCookies() });
    jar.delete(name);
  }
}

/** Avsluta demo: släpp demosessionen (endast den – scope local) → /login. */
export async function endDemoAction(): Promise<void> {
  await endDemoSession();
  redirect("/login");
}

/** "Skapa eget konto" i demon: avsluta demosessionen → registreringen. */
export async function endDemoToSignupAction(): Promise<void> {
  await endDemoSession();
  redirect("/signup");
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
