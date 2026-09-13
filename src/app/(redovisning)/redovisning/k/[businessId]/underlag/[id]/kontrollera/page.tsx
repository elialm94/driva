import { UnderlagKontrolleraView } from "@/components/accounting-workspace/underlag-kontrollera-view";
import { loadPortfolioWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Kontrollera belopp" };

export default async function AccountantKontrolleraPage({
  params,
}: {
  params: Promise<{ businessId: string; id: string }>;
}) {
  const { businessId, id } = await params;
  const ws = await loadPortfolioWorkspace(businessId);
  return <UnderlagKontrolleraView ws={ws} id={id} />;
}
