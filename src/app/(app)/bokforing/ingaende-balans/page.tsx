import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { IngaendeBalansView } from "@/components/ingaende-balans-view";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Ingående balans" };

export default async function IngaendeBalansPage() {
  await ensurePageBusiness();
  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Ingående balans"
        subtitle="Ta över en bokföring från ett annat program."
      />
      <IngaendeBalansView />
    </div>
  );
}
