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
import { endDemoSession } from "@/lib/auth/demo-provision";

/** Avsluta demo: släpp demosessionen (endast den – scope local) → landningssidan. */
export async function endDemoAction(): Promise<void> {
  await endDemoSession();
  revalidatePath("/", "layout");
  redirect("/");
}

/** "Skapa ditt eget konto" i demon: avsluta demosessionen → registrering. */
export async function endDemoToSignupAction(): Promise<void> {
  await endDemoSession();
  revalidatePath("/", "layout");
  redirect("/signup");
}
