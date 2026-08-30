import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { MomsPeriods } from "@/components/moms-periods";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { can } from "@/lib/collaboration/permissions";
import { vatChecklist, vatPeriods } from "@/lib/accounting/vat";
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
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);

  const periods = (
    isSupabaseMode()
      ? await (async () => {
          const state = await loadStateSnapshot(businessId);
          return runInTenantContext(
            { businessId, userId: access.user.id, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
            () => vatPeriods()
          );
        })()
      : vatPeriods()
  ).filter((p) => p.state !== "kommande");

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
