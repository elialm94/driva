import { PageHeader } from "@/components/ui";
import { PrintButton, VatPeriodicityPicker } from "@/components/bokforing-widgets";
import { MomsPeriods } from "@/components/moms-periods";
import { SkattekontoPanel } from "@/components/skattekonto-panel";
import { vatPeriodsFor } from "@/lib/accounting/vat";
import { vatFlowFocus, vatPeriodFlow } from "@/lib/accounting/vat-flow";
import { fiscalYears, resolveViewFiscalYear, vatPeriodicity, VAT_PERIODICITY } from "@/lib/accounting/fiscal";
import { FiscalYearPicker, fiscalYearHref } from "@/components/fiscal-year-picker";
import { taxAccountLedger } from "@/lib/accounting/tax-account";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Skatt" };

export default async function SkattPage({
  searchParams,
}: {
  searchParams: Promise<{ ar?: string; fokus?: string }>;
}) {
  await ensurePageBusiness();
  const params = await searchParams;
  const years = fiscalYears();
  const fy = resolveViewFiscalYear(params.ar);
  const periodicity = vatPeriodicity();
  const flows = vatPeriodsFor(fy).map((p) => vatPeriodFlow(p));
  const focusKey = flows.some((f) => f.summary.period.key === params.fokus) ? params.fokus : vatFlowFocus(flows);
  const ledger = taxAccountLedger();

  return (
    <div>
      <PageHeader
        title="Skatt"
        subtitle={`Moms, F-skatt och skattekontot på ett ställe. ${VAT_PERIODICITY[periodicity].short}.`}
        actions={ledger.rows.length > 0 || ledger.opening !== 0 ? <PrintButton /> : undefined}
      />
      <FiscalYearPicker years={years} activeLabel={fy.label} hrefFor={(y) => fiscalYearHref("/bokforing/skatt", y)} />
      <div className="mb-4">
        <VatPeriodicityPicker value={periodicity} />
      </div>
      <MomsPeriods flows={flows} focusKey={focusKey} />
      <div className="mt-10">
        <SkattekontoPanel />
      </div>
    </div>
  );
}
