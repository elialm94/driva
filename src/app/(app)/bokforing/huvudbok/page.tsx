import { HuvudbokView } from "@/components/accounting-workspace/huvudbok-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Huvudbok" };

export default async function HuvudbokPage({
  searchParams,
}: {
  searchParams: Promise<{ konto?: string; sida?: string; ar?: string }>;
}) {
  const [ws, params] = await Promise.all([loadOwnerWorkspace(), searchParams]);
  return <HuvudbokView ws={ws} searchParams={params} />;
}
