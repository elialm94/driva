import { SaldobalansView } from "@/components/accounting-workspace/saldobalans-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Saldobalans" };

export default async function AccountantSaldobalansViewPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string }>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <SaldobalansView ws={ws} searchParams={query} />;
}
