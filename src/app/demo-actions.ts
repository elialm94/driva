"use server";

/**
 * Demosessionens livscykel: avsluta (→ landningssidan) eller avsluta och gå
 * vidare till kontoskapande (→ /signup). Själva starten sker i GET /demo,
 * som sätter demo-cookien och klonar seedet till sessionens JSON-fil.
 *
 * Att avsluta slänger sessionens fil och rensar demokakorna – inget annat.
 * Supabase berörs aldrig: demon bor inte där.
 */
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { endDemoSession } from "@/lib/auth/demo-request";

/** Avsluta demo: släng sessionens fil + kakor → landningssidan. */
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
