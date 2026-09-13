import { ResultatView } from "@/components/accounting-workspace/resultat-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Resultatrapport" };

export default async function ResultatPage({ searchParams }: { searchParams: Promise<{ ar?: string }> }) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <ResultatView ws={ws} searchParams={params} />;
}
