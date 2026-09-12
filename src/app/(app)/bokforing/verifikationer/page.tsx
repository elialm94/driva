import { WorkspaceVerifikationerView } from "@/components/accounting-workspace/verifikationer-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Verifikationer" };

export default async function VerifikationerPage({
  searchParams,
}: {
  searchParams: Promise<{ sida?: string; v?: string }>;
}) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <WorkspaceVerifikationerView ws={ws} searchParams={params} />;
}
