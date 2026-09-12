import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { SkattekontoPanel } from "@/components/skattekonto-panel";
import { taxAccountLedger } from "@/lib/accounting/tax-account";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Skattekonto" };

export default async function SkattekontoPage() {
  await ensurePageBusiness();
  const ledger = taxAccountLedger();

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Skattekonto"
        subtitle="Bolagets konto hos Skatteverket. Moms, F-skatt och arbetsgivaravgifter dras härifrån, och du fyller på det från banken."
        actions={ledger.rows.length > 0 || ledger.opening !== 0 ? <PrintButton /> : undefined}
      />
      <SkattekontoPanel />
    </div>
  );
}
