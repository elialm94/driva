import { SaldobalansView } from "@/components/accounting-workspace/saldobalans-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Saldobalans" };

export default async function SaldobalansPage({ searchParams }: { searchParams: Promise<{ ar?: string }> }) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <SaldobalansView ws={ws} searchParams={params} />;
}
