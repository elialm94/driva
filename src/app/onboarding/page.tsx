import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/session";
import { sanitizeSignupPhone } from "@/lib/auth/signup-flow";
import { needsCompanyOnboarding } from "@/lib/onboarding";
import { membershipsForUser } from "@/lib/storage/adapter-supabase";
import { isSupabaseMode } from "@/lib/storage/config";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { OnboardingForm } from "./onboarding-form";

export const metadata: Metadata = { title: "Kom igång – Driva" };
export const dynamic = "force-dynamic";

/** Telefonen från registreringen (user metadata) prefyller kontaktfältet. */
async function signupPhoneFromMetadata(): Promise<string> {
  try {
    const supabase = await createSupabaseServerClient();
    const { data } = await supabase.auth.getClaims();
    const meta = data?.claims?.user_metadata as { phone?: unknown } | undefined;
    return sanitizeSignupPhone(meta?.phone) ?? "";
  } catch {
    return "";
  }
}

export default async function OnboardingPage() {
  if (!isSupabaseMode()) redirect("/"); // JSON-läget har ett färdigt demoföretag
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const memberships = await membershipsForUser(user.id);
  if (!needsCompanyOnboarding(memberships.length)) redirect("/");
  const defaultPhone = await signupPhoneFromMetadata();

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-6 text-center">
          <div className="text-2xl font-semibold tracking-tight text-stone-900">Välkommen till Driva</div>
          <p className="mt-1 text-sm text-stone-500">
            Fyll i företagsuppgifterna så att du kan skapa kunder och skicka din första faktura.
          </p>
        </div>
        <div className="rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <OnboardingForm defaultEmail={user.email} defaultPhone={defaultPhone} />
        </div>
      </div>
    </main>
  );
}
