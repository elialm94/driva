import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton, VatPeriodicityPicker } from "@/components/bokforing-widgets";
import { MomsPeriods } from "@/components/moms-periods";
import { FiscalYearPicker, fiscalYearHref } from "@/components/fiscal-year-picker";
import { VAT_PERIODICITY } from "@/lib/accounting/fiscal";
import { momsViewModel } from "@/lib/accounting-workspace/view-models";
import { isOwnerSurface, wsHref, wsReadOnly, type AccountingWorkspace } from "@/lib/accounting-workspace/shared";
import { kr } from "@/lib/format";

/**
 * Momsvyn – samma komponent på ägarens /bokforing/moms och konsultens
 * /redovisning/k/<id>/moms. Skillnaden är bara ws: basväg och behörighet.
 */
export function MomsView({
  ws,
  searchParams,
}: {
  ws: AccountingWorkspace;
  searchParams: { ar?: string; fokus?: string };
}) {
  const vm = momsViewModel(searchParams);
  const readOnly = wsReadOnly(ws, "vat");
  const base = wsHref(ws, "/bokforing/moms");

  return (
    <div>
      <PageHeader
        back={isOwnerSurface(ws) ? <SmartBack /> : undefined}
        title="Moms"
        subtitle={`Momsen räknas direkt ur bokföringen – samma siffror som huvudboken. ${VAT_PERIODICITY[vm.periodicity].short}.`}
        actions={<PrintButton />}
      />
      <FiscalYearPicker years={vm.years} activeLabel={vm.fy.label} hrefFor={(y) => fiscalYearHref(base, y)} />
      <div className="mb-4">
        <VatPeriodicityPicker value={vm.periodicity} readOnly={readOnly} />
      </div>
      {vm.current ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-[11px] text-muted">Utgående</p>
            <p className="text-[16px] font-semibold tabular">{kr(vm.current.position.utgaende)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">Ingående</p>
            <p className="text-[16px] font-semibold tabular">{kr(vm.current.position.ingaende)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">
              {vm.current.position.attBetala >= 0 ? "Att betala" : "Att få tillbaka"}
            </p>
            <p className="text-[16px] font-semibold tabular">{kr(Math.abs(vm.current.position.attBetala))}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">Status</p>
            <p className="text-[14px] font-semibold">{vm.currentStatus}</p>
          </Card>
        </div>
      ) : null}
      <MomsPeriods flows={vm.flows} focusKey={vm.focusKey} readOnly={readOnly} basePath={base} />
    </div>
  );
}
