import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { MomsPeriods } from "@/components/moms-periods";
import { vatPeriods } from "@/lib/accounting/vat";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Moms" };

export default async function MomsPage() {
  await ensurePageBusiness();
  const periods = vatPeriods().filter((p) => p.state !== "kommande");

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Moms"
        subtitle="Momsen räknas direkt ur bokföringen – samma siffror som huvudboken. Kvartalsmoms, deklareras den 12:e andra månaden efter periodens slut."
        actions={<PrintButton />}
      />
      <MomsPeriods periods={periods} />
    </div>
  );
}
