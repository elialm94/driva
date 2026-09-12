import { PageHeader } from "@/components/ui";
import { PeriodstangningView } from "@/components/periodstangning-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsHref, wsReadOnly } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Periodstängning" };

export default async function AccountantPeriodstangningPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);

  return (
    <div>
      <PageHeader title="Periodstängning" subtitle="Stäng månaden när den är klar, så står den kvar." />
      <PeriodstangningView
        hrefFor={(href) => wsHref(ws, href)}
        businessId={ws.actionBusinessId}
        readOnly={wsReadOnly(ws, "period_close")}
      />
    </div>
  );
}
