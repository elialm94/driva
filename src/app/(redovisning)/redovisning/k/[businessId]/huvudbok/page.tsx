import { HuvudbokView } from "@/components/accounting-workspace/huvudbok-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Huvudbok" };

export default async function AccountantHuvudbokPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ konto?: string; sida?: string; ar?: string }>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <HuvudbokView ws={ws} searchParams={query} />;
}
