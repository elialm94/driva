import { SettingsForm } from "@/components/settings-form";
import {
  billingReadiness,
  connectedBankSummary,
  getBusinessProfile,
  getInvoiceDefaults,
} from "@/lib/services/settings";
import { parseSettingsFlik } from "@/lib/settings-routes";
import { sanitizeReturnLabel, sanitizeReturnTo } from "@/lib/nav";

export const metadata = { title: "Inställningar" };

export default async function SettingsPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const flik = parseSettingsFlik(typeof searchParams.flik === "string" ? searchParams.flik : undefined);
  const profile = getBusinessProfile();
  const tillbaka = typeof searchParams.tillbaka === "string" ? sanitizeReturnTo(searchParams.tillbaka) : null;
  const tillbakaNamn =
    typeof searchParams.tillbakaNamn === "string" ? sanitizeReturnLabel(searchParams.tillbakaNamn) : null;

  return (
    <SettingsForm
      initial={profile}
      defaults={getInvoiceDefaults()}
      flik={flik}
      readiness={billingReadiness(profile)}
      bank={connectedBankSummary()}
      returnTo={tillbaka}
      returnLabel={tillbakaNamn}
    />
  );
}
