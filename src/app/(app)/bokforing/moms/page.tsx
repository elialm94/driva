import { PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton, VatPeriodicityPicker } from "@/components/bokforing-widgets";
import { MomsPeriods } from "@/components/moms-periods";
import { vatPeriodsFor } from "@/lib/accounting/vat";
import { fiscalYears, resolveViewFiscalYear, vatPeriodicity, VAT_PERIODICITY } from "@/lib/accounting/fiscal";
import { FiscalYearPicker, fiscalYearHref } from "@/components/fiscal-year-picker";
import { ensurePageBusiness } from "@/lib/auth/session";
import { vatReportsAwaitingTaxAccount } from "@/lib/accounting/tax-account";

export const metadata = { title: "Moms" };

export default async function MomsPage({
  searchParams,
}: {
  searchParams: Promise<{ ar?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const years = fiscalYears();
  const fy = resolveViewFiscalYear(params.ar);
  const periodicity = vatPeriodicity();
  const periods = vatPeriodsFor(fy).filter((p) => p.state !== "kommande");
  const awaitingTaxAccount = vatReportsAwaitingTaxAccount().map((r) => r.id);

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title="Moms"
        subtitle={`Momsen räknas direkt ur bokföringen – samma siffror som huvudboken. ${VAT_PERIODICITY[periodicity].short}.`}
        actions={<PrintButton />}
      />
      <FiscalYearPicker
        years={years}
        activeLabel={fy.label}
        hrefFor={(y) => fiscalYearHref("/bokforing/moms", y)}
      />
      <div className="mb-4">
        <VatPeriodicityPicker value={periodicity} />
      </div>
      <MomsPeriods periods={periods} awaitingTaxAccount={awaitingTaxAccount} />
    </div>
  );
}
