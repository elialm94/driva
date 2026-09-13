import { BankView } from "@/components/accounting-workspace/bank-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Bank" };

export default async function AccountantBankPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ businessId }, query] = await Promise.all([params, searchParams]);
  const ws = await loadPortfolioWorkspace(businessId);
  return <BankView ws={ws} searchParams={query} />;
}
