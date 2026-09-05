import { AccountantClientTabs } from "@/components/accountant-workspace";
import { PageHeader } from "@/components/ui";
import { AvstamningView, avstamningFiscalYear } from "@/components/avstamning-view";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantHref } from "@/lib/collaboration/hrefs";

export const metadata = { title: "Avstämning" };

export default async function AccountantAvstamningPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const { snap } = await loadAccountantClientPage(businessId);
  const fy = avstamningFiscalYear();

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`${snap.name} – avstämning${fy ? ` ${fy.label}` : ""}`}
        subtitle="Ett saldo är trovärdigt först när något utanför bokföringen säger samma sak."
      />
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      <AvstamningView hrefFor={(href) => accountantHref(businessId, href)} />
    </div>
  );
}
