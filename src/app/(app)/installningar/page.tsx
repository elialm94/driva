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
import { ensurePageBusiness, isDemoSession } from "@/lib/auth/session";
import { resolveOptionalFeatures } from "@/lib/features";
import { LOCAL_JSON_BUSINESS_ID } from "@/lib/collaboration/actor";
import { hydrateInvitationsFromTenant } from "@/lib/collaboration/service";
import { isSupabaseMode } from "@/lib/storage/config";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";
import { db } from "@/lib/store";

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
        features={(() => {
          const businessId = isSupabaseMode()
            ? requestSlot().businessId ?? tenantContext()?.businessId ?? LOCAL_JSON_BUSINESS_ID
            : LOCAL_JSON_BUSINESS_ID;
          hydrateInvitationsFromTenant(businessId);
          return resolveOptionalFeatures(db(), businessId);
        })()}
      />
      {/* Endast demon: JSON-läget lokalt eller den publika demosessionen.
          Servervägen (resetDemoAction) vaktar dessutom oberoende av UI:t. */}
      {isJsonDemoStore() || (await isDemoSession()) ? <DemoResetSection /> : null}
    </>
  );
}
