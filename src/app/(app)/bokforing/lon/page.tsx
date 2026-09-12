import { LonView } from "@/components/accounting-workspace/lon-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Lön" };

export default async function LonPage() {
  const ws = await loadOwnerWorkspace();
  return <LonView ws={ws} />;
}
