import { AccountantClientTabs } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { PeriodstangningView } from "@/components/periodstangning-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantHref } from "@/lib/collaboration/hrefs";
import { can } from "@/lib/collaboration/permissions";

export const metadata = { title: "Periodstängning" };

export default async function AccountantPeriodstangningPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`${snap.name} – periodstängning`}
        subtitle="Stäng månaden när den är klar, så står den kvar."
      />
      <AccountantClientTabs businessId={businessId} active="arbeta" />
      <PeriodstangningView
        hrefFor={(href) => accountantHref(businessId, href)}
        businessId={businessId}
        readOnly={!can(access.role, "period_close")}
      />
    </div>
  );
}
