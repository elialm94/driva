import { DeklarationerView } from "@/components/accounting-workspace/deklarationer-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Deklarationer & inlämning" };

export default async function DeklarationerPage() {
  const ws = await loadOwnerWorkspace();
  return <DeklarationerView ws={ws} />;
}
