import { MomsView } from "@/components/accounting-workspace/moms-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Moms" };

export default async function AccountantMomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string; fokus?: string }>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <MomsView ws={ws} searchParams={query} />;
}
