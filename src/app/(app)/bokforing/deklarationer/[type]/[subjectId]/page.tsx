import { DeklarationDetailView } from "@/components/accounting-workspace/deklaration-detail-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Deklaration" };

export default async function DeklarationPage(props: { params: Promise<{ type: string; subjectId: string }> }) {
  const [ws, { type, subjectId }] = await Promise.all([loadOwnerWorkspace(), props.params]);
  return <DeklarationDetailView ws={ws} type={type} subjectId={decodeURIComponent(subjectId)} />;
}
