import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { vatPeriods } from "@/lib/accounting/vat";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";

export const metadata = { title: "Bokslut" };

export default async function AccountantBokslutPage({
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
          () => ({ years: fiscalYears(), vat: vatPeriods() })
        );
      })()
    : { years: fiscalYears(), vat: vatPeriods() };

  const current = data.years[data.years.length - 1];
  const vatOpen = data.vat.filter((p) => p.state === "att_deklarera");
  const checks = [
    { key: "bank", label: "Bank avstämd", ok: snap.bankOk },
    { key: "queue", label: "Inga öppna undantag", ok: snap.queue.length === 0, detail: snap.queue.length ? `${snap.queue.length} saker` : undefined },
    { key: "moms", label: "Momsperioder deklarerade", ok: vatOpen.length === 0, detail: vatOpen.length ? vatOpen.map((p) => p.period.label).join(", ") : undefined },
    { key: "lock", label: "Period låst", ok: Boolean(snap.bookedThrough), detail: snap.bookedThrough ?? "Ingen periodlåsning" },
  ];
  const done = checks.filter((c) => c.ok).length;

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
      <AccountantClientTabs businessId={businessId} active="bokslut" />
      <Card className="p-4">
        <h2 className="text-[15px] font-semibold">
          Bokslut {current?.label ?? "—"} — {done}/{checks.length} kontroller klara
        </h2>
        <ul className="mt-3 space-y-2 text-[14px]">
          {checks.map((c) => (
            <li key={c.key} className="flex items-start gap-2">
              <span className={c.ok ? "text-ok" : "text-warn"}>{c.ok ? "✓" : "·"}</span>
              <span>
                {c.label}
                {c.detail && !c.ok ? <span className="block text-[12px] text-muted">{c.detail}</span> : null}
              </span>
            </li>
          ))}
        </ul>
      </Card>
      <Card className="mt-3 p-4">
        <h3 className="mb-2 text-[13px] font-semibold">Räkenskapsår</h3>
        <ul className="space-y-1 text-[13px]">
          {data.years.map((y) => (
            <li key={y.id}>
              {y.label ?? y.startDate} · {y.status}
            </li>
          ))}
          {data.years.length === 0 ? <li className="text-soft">Inget räkenskapsår ännu.</li> : null}
        </ul>
      </Card>
    </div>
  );
}
