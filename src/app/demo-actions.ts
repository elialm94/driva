"use server";

/**
 * Demosessionens livscykel: avsluta (→ landningssidan) eller avsluta och gå
 * vidare till kontoskapande (→ /signup). Själva starten sker i GET /demo,
 * som provisionerar en isolerad demosession per besökare.
 *
 * När besökaren lämnar demon flyttas demoföretagets utgångstid till nu
 * (frystriggern tillåter bara tidigareläggning) så att cleanup-vägen tar
 * datat vid nästa körning i stället för att vänta ut hela livslängden.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isSupabaseMode } from "@/lib/storage/config";
import { getSessionUser, isDemoSession } from "@/lib/auth/session";
import { clearDemoCookies } from "@/lib/auth/demo-provision";
import { membershipsForUser, sqlClient } from "@/lib/storage/adapter-supabase";
import { bindTransaction } from "@/lib/storage/load";

/** Avsluta demo: släpp demosessionen (endast den – scope local) → landningssidan. */
export async function endDemoAction(): Promise<void> {
  await endDemoSession();
  redirect("/");
}

/** "Skapa ditt eget konto" i demon: avsluta demosessionen → registrering. */
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
  if (user && (await isDemoSession())) {
    await expireDemoBusinessesNow(user.id);
    const supabase = await createSupabaseServerClient();
    // scope "local": släpp bara DENNA besökares tokens – demosessionen är
    // besökarens egen, men mönstret skyddar även äldre delade demokonton.
    await supabase.auth.signOut({ scope: "local" });
  }
  await clearDemoCookies();
  revalidatePath("/", "layout");
}

/** Bäst ansträngning: markera besökarens demoföretag för omedelbar städning. */
async function expireDemoBusinessesNow(userId: string): Promise<void> {
  try {
    const memberships = await membershipsForUser(userId);
    const client = await sqlClient();
    for (const m of memberships) {
      await client.transaction(async (tx) => {
        await bindTransaction(tx, m.businessId);
        // Endast demoföretag med utgångstid – frystriggern nekar förlängning,
        // och WHERE-villkoret gör att riktiga företag aldrig berörs.
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
