import { UnderlagKontrolleraView } from "@/components/accounting-workspace/underlag-kontrollera-view";
import { loadOwnerWorkspace } from "@/lib/accounting-workspace/workspace";

export const metadata = { title: "Kontrollera belopp" };

export default async function KontrolleraPage(props: { params: Promise<{ id: string }> }) {
  const [ws, { id }] = await Promise.all([loadOwnerWorkspace(), props.params]);
  return <UnderlagKontrolleraView ws={ws} id={id} />;
}
