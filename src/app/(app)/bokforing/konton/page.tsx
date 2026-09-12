import { KontonView } from "@/components/accounting-workspace/konton-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Konton" };

export default async function KontonPage() {
  const ws = await loadOwnerWorkspace();
  return <KontonView ws={ws} />;
}
