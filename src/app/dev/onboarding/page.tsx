import { redirect } from "next/navigation";
import { isSupabaseMode } from "@/lib/storage/config";
import { OnboardingForm } from "@/app/onboarding/onboarding-form";
import { OnboardingShell } from "@/app/onboarding/onboarding-shell";
import { PersonalizeForm } from "@/app/onboarding/personalize-form";

export const dynamic = "force-dynamic";

/**
 * Lokal förhandsvisning av onboardingens två steg (JSON-läget saknar
 * riktiga konton). Formulären är de riktiga; inskick svarar ärligt att
 * Supabase krävs. Finns inte i Supabase-läget.
 */
export default async function DevOnboardingPreview({ searchParams }: { searchParams: Promise<{ steg?: string }> }) {
  if (isSupabaseMode()) redirect("/");
  const { steg } = await searchParams;
  if (steg === "2") {
    return (
      <OnboardingShell
        step={2}
        title="Anpassa Ferva efter företaget"
        lead="Några snabba val hjälper oss att visa rätt saker från början. Inget val låser dig."
        eyebrow="Ekvägens El AB"
      >
        <PersonalizeForm />
      </OnboardingShell>
    );
  }
  return (
    <OnboardingShell step={1} title="Berätta om företaget" lead="Vi använder uppgifterna på offerter, fakturor och i bokföringen. Du kan ändra dem senare.">
      <OnboardingForm defaultEmail="du@example.se" defaultPhone="070-123 45 67" />
    </OnboardingShell>
  );
}
