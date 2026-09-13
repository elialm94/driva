import { SkattekontoView } from "@/components/accounting-workspace/skattekonto-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Skattekonto" };

export default async function AccountantSkattekontoPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <SkattekontoView ws={ws} />;
}
