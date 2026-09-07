import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { MomsPeriods } from "@/components/moms-periods";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { vatPeriodsFor } from "@/lib/accounting/vat";
import { vatFlowFocus, vatPeriodFlow, type VatPeriodFlow } from "@/lib/accounting/vat-flow";
import { fiscalYears, resolveViewFiscalYear } from "@/lib/accounting/fiscal";
import { FiscalYearPicker, fiscalYearHref } from "@/components/fiscal-year-picker";
import { kr } from "@/lib/format";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";

export const metadata = { title: "Moms" };

function momsStatus(state: string, blockers: number): string {
  if (state === "deklarerad") return "Granskad";
  if (state === "att_deklarera" && blockers === 0) return "Redo för granskning";
  if (state === "att_deklarera") return "Behöver hanteras";
  return "Pågår";
}

export default async function AccountantMomsPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string; fokus?: string }>;
}) {
  const { businessId } = await params;
  const { ar, fokus } = await searchParams;
  const { access, snap } = await loadAccountantClientPage(businessId);

  const loadView = (): { fy: ReturnType<typeof resolveViewFiscalYear>; years: ReturnType<typeof fiscalYears>; flows: VatPeriodFlow[] } => {
    const fy = resolveViewFiscalYear(ar);
    return {
      fy,
      years: fiscalYears(),
      flows: vatPeriodsFor(fy)
        .filter((p) => p.state !== "kommande")
        .map((p) => vatPeriodFlow(p)),
    };
  };
  const view = isSupabaseMode()
    ? await (async () => {
        const state = await loadStateSnapshot(businessId);
        return runInTenantContext(
          { businessId, userId: access.user.id, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
          loadView
        );
      })()
    : loadView();
  const { fy, years, flows } = view;

  const currentFlow =
    flows.find((f) => f.summary.state === "att_deklarera") ?? flows.find((f) => f.summary.state === "pagaende");
  const current = currentFlow?.summary;
  const blockers = currentFlow?.blockers.length ?? 0;
  const focusKey = flows.some((f) => f.summary.period.key === fokus) ? fokus : vatFlowFocus(flows);

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={snap.name}
        subtitle={accountantStatusText({
          bookedThrough: snap.bookedThrough,
          bankOk: snap.bankOk,
          bankUnexplained: snap.bankUnexplained,
          nextVatDue: snap.nextVat?.dueDate,
        })}
      />
      <AccountantClientTabs businessId={businessId} active="moms" />
      <FiscalYearPicker
        years={years}
        activeLabel={fy.label}
        hrefFor={(y) => fiscalYearHref(`/redovisning/k/${businessId}/moms`, y)}
      />
      {current ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-4">
          <Card className="p-3">
            <p className="text-[11px] text-muted">Utgående</p>
            <p className="text-[16px] font-semibold tabular">{kr(current.position.utgaende)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">Ingående</p>
            <p className="text-[16px] font-semibold tabular">{kr(current.position.ingaende)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">
              {current.position.attBetala >= 0 ? "Att betala" : "Att få tillbaka"}
            </p>
            <p className="text-[16px] font-semibold tabular">{kr(Math.abs(current.position.attBetala))}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">Status</p>
            <p className="text-[14px] font-semibold">{momsStatus(current.state, blockers)}</p>
          </Card>
        </div>
      ) : null}
      <MomsPeriods
        flows={flows}
        focusKey={focusKey}
        readOnly={!can(access.role, "vat")}
        basePath={`/redovisning/k/${businessId}/moms`}
      />
    </div>
  );
}
