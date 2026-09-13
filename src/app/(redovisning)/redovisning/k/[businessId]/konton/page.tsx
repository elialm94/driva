import { KontonView } from "@/components/accounting-workspace/konton-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Konton" };

export default async function AccountantKontonPage({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <KontonView ws={ws} />;
}
