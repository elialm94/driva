import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader, cx } from "@/components/ui";
import { CustomerRegister } from "@/components/customer-list";
import { KunderHeaderActions } from "@/components/kunder-header-actions";
import { UppdragList, type UppdragListQuery } from "@/components/uppdrag-list";
import {
  listCustomersForTable,
  type CustomerActivityFilter,
  type CustomerKindFilter,
  type CustomerPaymentFilter,
  type CustomerSort,
} from "@/lib/services/customers";
import { listJobsForTable, type JobEconomyFilter, type JobLifecycleFilter, type JobSort } from "@/lib/services/job-list";
import { KUNDER_TABS, type KunderTab } from "@/lib/nav";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Kunder" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

export default async function CustomersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const flik = str(searchParams.flik);
  if (flik === "forfragningar") redirect("/kunder?flik=uppdrag");
  const tab: KunderTab = flik === "uppdrag" ? "uppdrag" : "kunder";
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const uppdragQuery: UppdragListQuery = {
    q: str(searchParams.q),
    lifecycle: parseLifecycle(str(searchParams.visning)),
    economy: parseEconomy(str(searchParams.ekonomi)),
    sort: parseJobSort(str(searchParams.sortering)),
    page: Number(str(searchParams.sida)) || 1,
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={tab === "uppdrag" ? "Uppdrag" : "Kunder"}
        subtitle={
          tab === "uppdrag"
            ? "Vad som är beställt, när det sker, vad som är fakturerat och vad som är kvar."
            : "Alla du jobbar med eller pratar med – allt kopplas ihop automatiskt."
        }
        actions={<KunderHeaderActions customers={customers} />}
      />

      <div className="mb-5 flex gap-1 overflow-x-auto rounded-2xl bg-ink/4 p-1">
        {KUNDER_TABS.map((t) => (
          <Link
            key={t.key}
            href={t.href as never}
            className={cx(
              "flex min-h-11 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 py-2 text-center text-sm font-medium transition-all",
              tab === t.key ? "bg-card text-ink shadow-sm" : "text-muted hover:text-ink"
            )}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "uppdrag" ? (
        <UppdragList
          result={listJobsForTable({
            q: uppdragQuery.q,
            lifecycle: uppdragQuery.lifecycle,
            economy: uppdragQuery.economy,
            sort: uppdragQuery.sort,
            page: uppdragQuery.page,
          })}
          query={uppdragQuery}
        />
      ) : (
        <CustomerRegister
          result={listCustomersForTable({
            q: str(searchParams.q),
            kind: parseKind(str(searchParams.typ)),
            activity: parseActivity(str(searchParams.aktivitet)),
            payment: parsePayment(str(searchParams.betalning)),
            sort: parseSort(str(searchParams.sortering)),
            page: Number(str(searchParams.sida)) || 1,
          })}
          query={{
            q: str(searchParams.q),
            kind: parseKind(str(searchParams.typ)),
            activity: parseActivity(str(searchParams.aktivitet)),
            payment: parsePayment(str(searchParams.betalning)),
            sort: parseSort(str(searchParams.sortering)),
            page: Number(str(searchParams.sida)) || 1,
          }}
        />
      )}
    </div>
  );
}

function parseKind(value: string): CustomerKindFilter {
  return value === "privat" || value === "foretag" ? value : "alla";
}

function parseActivity(value: string): CustomerActivityFilter {
  return value === "uppdrag" || value === "ingen" ? value : "alla";
}

function parsePayment(value: string): CustomerPaymentFilter {
  return value === "obetalt" || value === "forsenad" ? value : "alla";
}

function parseSort(value: string): CustomerSort {
  return value === "namn" || value === "attBetala" ? value : "aktivitet";
}

function parseLifecycle(value: string): JobLifecycleFilter {
  return value === "planerade" || value === "klart" || value === "alla" || value === "arkiverade"
    ? value
    : "aktiva";
}

function parseEconomy(value: string): JobEconomyFilter {
  return value === "kvar" || value === "vantar" || value === "betalt" ? value : "alla";
}

function parseJobSort(value: string): JobSort {
  return value === "datum" || value === "kund" || value === "belopp" ? value : "standard";
}
