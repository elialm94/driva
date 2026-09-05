import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton, VatPeriodicityPicker } from "@/components/bokforing-widgets";
import { MomsPeriods } from "@/components/moms-periods";
import { vatPeriods } from "@/lib/accounting/vat";
import { vatPeriodicity, VAT_PERIODICITY } from "@/lib/accounting/fiscal";
import { ensurePageBusiness } from "@/lib/auth/session";
import { vatReportsAwaitingTaxAccount } from "@/lib/accounting/tax-account";

export const metadata = { title: "Moms" };

export default async function MomsPage() {
  await ensurePageBusiness();
  const periodicity = vatPeriodicity();
  const periods = vatPeriods().filter((p) => p.state !== "kommande");
  const awaitingTaxAccount = vatReportsAwaitingTaxAccount().map((r) => r.id);

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Moms"
        subtitle={`Momsen räknas direkt ur bokföringen – samma siffror som huvudboken. ${VAT_PERIODICITY[periodicity].short}.`}
        actions={<PrintButton />}
      />
      <div className="mb-4">
        <VatPeriodicityPicker value={periodicity} />
      </div>
      <MomsPeriods periods={periods} awaitingTaxAccount={awaitingTaxAccount} />
    </div>
  );
}
