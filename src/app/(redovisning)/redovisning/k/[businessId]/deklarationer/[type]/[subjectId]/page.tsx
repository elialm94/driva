import { DeklarationDetailView } from "@/components/accounting-workspace/deklaration-detail-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Deklaration" };

export default async function AccountantDeklarationPage({
  params,
}: {
  params: Promise<{ businessId: string; type: string; subjectId: string }>;
}) {
  const { businessId, type, subjectId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <DeklarationDetailView ws={ws} type={type} subjectId={decodeURIComponent(subjectId)} />;
}
