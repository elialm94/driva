import { BalansView } from "@/components/accounting-workspace/balans-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Balansrapport" };

export default async function BalansPage({ searchParams }: { searchParams: Promise<{ ar?: string }> }) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <BalansView ws={ws} searchParams={params} />;
}
