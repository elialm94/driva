import { AccountantQueue } from "@/components/accountant-queue";
import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantActionHref } from "@/lib/collaboration/portfolio";
import { matchesAccountantFilter } from "@/lib/collaboration/issues";
import { bankReconciliation } from "@/lib/accounting/reconciliation";
import { listBankForTable } from "@/lib/services/economy-list";
import { kr, datumKort } from "@/lib/format";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";
import { hasConnectedBank } from "@/lib/banking/connection-state";

export const metadata = { title: "Bank" };

export default async function AccountantBankPage({
  params,
}: {
  params: Promise<{ businessId: string }>;
}) {
  const { businessId } = await params;
  const { access, snap } = await loadAccountantClientPage(businessId);

  const data = isSupabaseMode()
    ? await (async () => {
        const state = await loadStateSnapshot(businessId);
        return runInTenantContext(
          { businessId, userId: access.user.id, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
          () => ({
            recon: bankReconciliation(),
            rows: listBankForTable({ status: "atgard", pageSize: 40 }).rows,
            connected: hasConnectedBank(),
          })
        );
      })()
    : {
        recon: bankReconciliation(),
        rows: listBankForTable({ status: "atgard", pageSize: 40 }).rows,
        connected: hasConnectedBank(),
      };

  const bankActions = [...snap.queue, ...snap.waiting]
    .filter((a) => matchesAccountantFilter(a, "bank"))
    .map((a) => ({ ...a, href: accountantActionHref(businessId, a) }));

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
      <AccountantClientTabs businessId={businessId} active="bank" />

      {!data.connected ? (
        <Card className="mb-5 p-4">
          <p className="text-[14px] font-medium">Bank ej ansluten</p>
          <p className="mt-1 text-[13px] text-soft">
            Inget bankkonto är kopplat. Driva låtsas inte att en anslutning finns.
          </p>
        </Card>
      ) : (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          <Card className="p-3">
            <p className="text-[11px] text-muted">Banksaldo</p>
            <p className="text-[16px] font-semibold tabular">{kr(data.recon.bankBalance)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">Bokfört 1930</p>
            <p className="text-[16px] font-semibold tabular">{kr(data.recon.ledgerBalance)}</p>
          </Card>
          <Card className="p-3">
            <p className="text-[11px] text-muted">{data.recon.ok ? "Avstämd" : "Differens"}</p>
            <p className="text-[16px] font-semibold tabular">{kr(Math.abs(data.recon.unexplained))}</p>
          </Card>
        </div>
      )}

      <AccountantQueue
        title="Behöver bedömning"
        items={bankActions}
        initialVisible={20}
        empty={<p className="mb-4 text-[13px] text-soft">Inga bankundantag just nu.</p>}
      />

      {data.rows.length > 0 ? (
        <div className="mt-6 overflow-hidden rounded-xl border border-line bg-card">
          <p className="border-b border-line px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted">
            Ej matchade
          </p>
          <ul>
            {data.rows.map((r) => (
              <li
                key={r.id}
                className="flex items-baseline justify-between gap-3 border-b border-line/70 px-3 py-2 last:border-b-0"
              >
                <span className="min-w-0 truncate text-[13px]">
                  {r.counterpart} · {r.description}
                </span>
                <span className="shrink-0 text-[12px] text-soft">
                  {datumKort(r.date)} · {kr(r.amount)} · {r.statusLabel}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
