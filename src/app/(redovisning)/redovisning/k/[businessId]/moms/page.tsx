import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { MomsPeriods } from "@/components/moms-periods";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { vatChecklist, vatPeriodsFor } from "@/lib/accounting/vat";
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
  searchParams: Promise<{ ar?: string }>;
}) {
  const { businessId } = await params;
  const { ar } = await searchParams;
  const { access, snap } = await loadAccountantClientPage(businessId);

  const loadView = () => {
    const fy = resolveViewFiscalYear(ar);
    return {
      fy,
      years: fiscalYears(),
      periods: vatPeriodsFor(fy).filter((p) => p.state !== "kommande"),
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
  const { fy, years, periods } = view;

  const current = periods.find((p) => p.state === "att_deklarera") ?? periods.find((p) => p.state === "pagaende");
  const blockers = current ? vatChecklist(current.period).filter((c) => !c.ok).length : 0;

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
      <MomsPeriods periods={periods} readOnly={!can(access.role, "vat")} />
    </div>
  );
}
