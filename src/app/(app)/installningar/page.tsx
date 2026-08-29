import { SettingsForm } from "@/components/settings-form";
import { DemoResetSection } from "@/components/demo-reset-section";
import { isJsonDemoStore } from "@/lib/demo";
import {
  billingReadiness,
  connectedBankSummary,
  getBusinessProfile,
  getInvoiceDefaults,
} from "@/lib/services/settings";
import { parseSettingsFlik } from "@/lib/settings-routes";
import { sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";
import { primaryDomain } from "@/lib/domains";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Inställningar" };

export default async function SettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const flik = parseSettingsFlik(typeof searchParams.flik === "string" ? searchParams.flik : undefined);
  const profile = getBusinessProfile();
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;

  return (
    <>
      <SettingsForm
        initial={profile}
        defaults={getInvoiceDefaults()}
        flik={flik}
        readiness={billingReadiness(profile)}
        bank={connectedBankSummary()}
        returnTo={tillbaka}
        returnLabel={tillbakaNamn}
        domainSummary={(() => {
          const d = primaryDomain();
          return d ? { hostname: d.hostname, live: d.status === "active" } : null;
        })()}
      />
      {/* Endast JSON-demoläget: samma servergrind som resetDemoData kräver
          (assertJsonMode) – i Supabase-/produktionsläge renderas inget. */}
      {isJsonDemoStore() ? <DemoResetSection /> : null}
    </>
  );
}
