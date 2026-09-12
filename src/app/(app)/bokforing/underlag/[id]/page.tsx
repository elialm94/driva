import { UnderlagDetailView } from "@/components/accounting-workspace/underlag-detail-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Underlag" };

export default async function InboxDetailPage(props: { params: Promise<{ id: string }> }) {
  const [ws, { id }] = await Promise.all([loadOwnerWorkspace(), props.params]);
  return <UnderlagDetailView ws={ws} id={id} />;
}
