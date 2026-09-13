import { DeklarationerView } from "@/components/accounting-workspace/deklarationer-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Deklarationer & inlämning" };

export default async function AccountantDeklarationerPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <DeklarationerView ws={ws} />;
}
