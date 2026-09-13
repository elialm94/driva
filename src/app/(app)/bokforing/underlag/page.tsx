import { UnderlagView } from "@/components/accounting-workspace/underlag-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Underlag" };

export default async function InboxPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), props.searchParams]);
  return <UnderlagView ws={ws} searchParams={params} />;
}
