import { LonespecifikationView } from "@/components/accounting-workspace/lonespecifikation-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Lönespecifikation" };

export default async function LonespecifikationPage({ params }: { params: Promise<{ runId: string }> }) {
  const [ws, { runId }] = await Promise.all([loadOwnerWorkspace(), params]);
  return <LonespecifikationView ws={ws} runId={runId} />;
}
