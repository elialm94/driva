import { BankView } from "@/components/accounting-workspace/bank-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Bank" };

export default async function BokforingBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <BankView ws={ws} searchParams={params} />;
}
