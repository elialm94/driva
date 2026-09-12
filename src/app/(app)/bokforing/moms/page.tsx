import { MomsView } from "@/components/accounting-workspace/moms-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Moms" };

export default async function MomsPage({
  searchParams,
}: {
  searchParams: Promise<{ ar?: string; fokus?: string }>;
}) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <MomsView ws={ws} searchParams={params} />;
}
