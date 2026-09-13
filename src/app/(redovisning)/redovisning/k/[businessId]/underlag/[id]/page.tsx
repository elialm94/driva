import { UnderlagDetailView } from "@/components/accounting-workspace/underlag-detail-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Underlag" };

export default async function AccountantUnderlagDetailPage({
  params,
}: {
  params: Promise<{ businessId: string; id: string }>;
}) {
  const { businessId, id } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <UnderlagDetailView ws={ws} id={id} />;
}
