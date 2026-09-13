import { WorkspaceVerifikationerView } from "@/components/accounting-workspace/verifikationer-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Verifikationer" };

export default async function AccountantVerifikationerPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ sida?: string; v?: string }>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <WorkspaceVerifikationerView ws={ws} searchParams={query} />;
}
