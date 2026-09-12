import { LonView } from "@/components/accounting-workspace/lon-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Lön" };

export default async function AccountantLonPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <LonView ws={ws} />;
}
