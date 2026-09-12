import { LonespecifikationView } from "@/components/accounting-workspace/lonespecifikation-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Lönespecifikation" };

export default async function AccountantLonespecifikationPage({
  params,
}: {
  params: Promise<{ businessId: string; runId: string }>;
}) {
  const { businessId, runId } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <LonespecifikationView ws={ws} runId={runId} />;
}
