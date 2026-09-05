import { AccountantClientTabs } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { IngaendeBalansView } from "@/components/ingaende-balans-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";

export const metadata = { title: "Ingående balans" };

export default async function AccountantIngaendeBalansPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`${snap.name} – ingående balans`}
        subtitle="Ta över klientens bokföring från det gamla programmet."
      />
      <AccountantClientTabs businessId={businessId} active="arbeta" />
      <IngaendeBalansView businessId={businessId} readOnly={!can(access.role, "year_end")} />
    </div>
  );
}
