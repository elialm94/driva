import type { Metadata } from "next";
import { redirect } from "next/navigation";
import {
  getSessionUser,
  isDemoSession,
  listMemberships,
  sessionPhoneHint,
  withBusinessRead,
} from "@/lib/auth/session";
import { isOwnerRole } from "@/lib/collaboration/permissions";
import { isSupabaseMode } from "@/lib/storage/config";
import { db } from "@/lib/store";
import { resumeStepFor } from "@/lib/setup/onboarding-state";
import { OnboardingForm } from "./onboarding-form";
import { OnboardingShell as Shell } from "./onboarding-shell";
import { PersonalizeForm } from "./personalize-form";

export const metadata: Metadata = { title: "Kom igång – Ferva" };
export const dynamic = "force-dynamic";

/**
 * Två korta steg. Steget avgörs av sparat tillstånd, inte av URL:en:
 *   inget eget företag                      → 1 Berätta om företaget
 *   företag med onboarding ≠ klar           → 2 Anpassa Ferva
 *   klar                                    → Hem
 * Sidan använder aldrig requireBusiness (den skickar hit) – ingen loop.
 */
export default async function OnboardingPage() {
  if (await isDemoSession()) redirect("/"); // demon har redan sitt exempelföretag
  if (!isSupabaseMode()) redirect("/"); // JSON-läget har ett färdigt demoföretag
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const memberships = await listMemberships(user.id);
  const owned = memberships.filter((m) => isOwnerRole(m.role));
  // Enbart konsultmedlemskap: ingen egen onboarding – Hem avgör (→ /redovisning).
  if (owned.length === 0 && memberships.length > 0) redirect("/");

  const step = resumeStepFor({ hasBusiness: owned.length > 0, status: owned[0]?.onboardingStatus });
  if (step === "done") redirect("/");

  if (step === "company") {
    return (
      <Shell step={1} title="Berätta om företaget" lead="Vi använder uppgifterna på offerter, fakturor och i bokföringen. Du kan ändra dem senare.">
        <OnboardingForm defaultEmail={user.email} defaultPhone={await sessionPhoneHint()} />
      </Shell>
    );
  }

  const businessId = owned[0].businessId;
  const defaults = await withBusinessRead(
    () => {
      const o = db().onboarding;
      return {
        companyName: db().settings.name,
        industries: o?.industries ?? [],
        otherIndustry: o?.otherIndustry,
        payroll: o?.payroll ?? null,
        bookkeeping: o?.bookkeeping ?? null,
      };
    },
    { businessId },
  );

  return (
    <Shell
      step={2}
      title="Anpassa Ferva efter företaget"
      lead="Några snabba val hjälper oss att visa rätt saker från början. Inget val låser dig."
      eyebrow={defaults.companyName}
    >
      <PersonalizeForm defaults={defaults} />
    </Shell>
  );
}
