import Link from "next/link";
import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { Card, PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { balansrapport, resultatrapport, saldobalans } from "@/lib/accounting/ledger";
import { fiscalYearAsOf, fiscalYears, resolveViewFiscalYear } from "@/lib/accounting/fiscal";
import { FiscalYearPicker, fiscalYearHref } from "@/components/fiscal-year-picker";
import { kr } from "@/lib/format";
import { isSupabaseMode } from "@/lib/storage/config";
import { loadStateSnapshot } from "@/lib/storage/adapter-supabase";
import { runInTenantContext } from "@/lib/storage/context";

export const metadata = { title: "Rapporter" };

export default async function AccountantRapporterPage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ ar?: string }>;
}) {
  const { businessId } = await params;
  const { ar } = await searchParams;
  const { access, snap } = await loadAccountantClientPage(businessId);
  const reportsFor = () => {
    const fy = resolveViewFiscalYear(ar);
    const range = { from: fy.startDate, to: fy.endDate };
    return {
      fy,
      years: fiscalYears(),
      resultat: resultatrapport(range),
      balans: balansrapport(fiscalYearAsOf(fy)),
      saldo: saldobalans(range),
    };
  };
  const reports = isSupabaseMode()
    ? await (async () => {
        const state = await loadStateSnapshot(businessId);
        return runInTenantContext(
          { businessId, userId: access.user.id, writable: false, state, baseline: state, stateVersion: 0, dirty: false },
          reportsFor
        );
      })()
    : reportsFor();

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
      <AccountantClientTabs businessId={businessId} active="rapporter" />
      <FiscalYearPicker
        years={reports.years}
        activeLabel={reports.fy.label}
        hrefFor={(y) => fiscalYearHref(`/redovisning/k/${businessId}/rapporter`, y)}
      />
      <div className="grid gap-3 md:grid-cols-3">
        <Card className="p-4">
          <h2 className="mb-1 text-[13px] font-semibold">Resultat</h2>
          <p className="text-[22px] font-semibold tabular">{kr(reports.resultat.resultat)}</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 text-[13px] font-semibold">Balans</h2>
          <p className="text-[22px] font-semibold tabular">{kr(reports.balans.sumTillgangar)}</p>
          <p className="mt-1 text-[12px] text-soft">Tillgångar ur samma verifikationer.</p>
        </Card>
        <Card className="p-4">
          <h2 className="mb-1 text-[13px] font-semibold">Saldobalans</h2>
          <p className="text-[22px] font-semibold tabular">{reports.saldo.rows.length} konton</p>
        </Card>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-[13px]">
        <a href="/api/bokforing/export?typ=sie" className="font-medium text-accent hover:underline">
          Exportera SIE
        </a>
        <Link href={`/redovisning/k/${businessId}/verifikationer`} className="text-soft hover:text-ink">
          Huvudbok / verifikationer
        </Link>
      </div>
    </div>
  );
}
