import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokslutView } from "@/components/bokslut-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Bokslut" };

export default async function BokslutPage() {
  await ensurePageBusiness();
  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Bokslut"
        subtitle="Driva kontrollerar allt som går att kontrollera automatiskt – du ser bara det som faktiskt behöver dig."
        actions={<PrintButton />}
      />
      <BokslutView base="/bokforing/bokslut" />
    </div>
  );
}
