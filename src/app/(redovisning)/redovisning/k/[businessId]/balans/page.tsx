import { BalansView } from "@/components/accounting-workspace/balans-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Balansrapport" };

export default async function AccountantBalansViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string }>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <BalansView ws={ws} searchParams={query} />;
}
