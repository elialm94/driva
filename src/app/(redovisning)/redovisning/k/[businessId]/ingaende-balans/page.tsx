import { PageHeader } from "@/components/ui";
import { IngaendeBalansView } from "@/components/ingaende-balans-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";
import { wsReadOnly } from "@/lib/accounting-workspace/shared";

export const metadata = { title: "Ingående balans" };

export default async function AccountantIngaendeBalansPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);

  return (
    <div>
      <PageHeader title="Ingående balans" subtitle="Ta över klientens bokföring från det gamla programmet." />
      <IngaendeBalansView businessId={ws.actionBusinessId} readOnly={wsReadOnly(ws, "year_end")} />
    </div>
  );
}
