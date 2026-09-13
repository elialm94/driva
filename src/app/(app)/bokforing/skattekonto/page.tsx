import { SkattekontoView } from "@/components/accounting-workspace/skattekonto-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Skattekonto" };

export default async function SkattekontoPage() {
  const ws = await loadOwnerWorkspace();
  return <SkattekontoView ws={ws} />;
}
