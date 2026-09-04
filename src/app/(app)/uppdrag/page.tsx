import { PageHeader } from "@/components/ui";
import { KunderHeaderActions } from "@/components/kunder-header-actions";
import { UppdragList, type UppdragListQuery } from "@/components/uppdrag-list";
import { listJobsForTable, type JobEconomyFilter, type JobLifecycleFilter, type JobSort } from "@/lib/services/job-list";
import { db } from "@/lib/store";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Uppdrag" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

/** Kanoniska uppdragslistan – primär nav-sektion. Samma UppdragList/filter som tidigare flik under Kunder. */
export default async function UppdragPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await ensurePageBusiness();
  const searchParams = await props.searchParams;
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  const query: UppdragListQuery = {
    q: str(searchParams.q),
    lifecycle: parseLifecycle(str(searchParams.visning)),
    economy: parseEconomy(str(searchParams.ekonomi)),
    sort: parseJobSort(str(searchParams.sortering)),
    page: Number(str(searchParams.sida)) || 1,
  };

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Uppdrag"
        subtitle="Vad som är beställt, när det sker, vad som är fakturerat och vad som är kvar."
        stackActions
        actions={<KunderHeaderActions customers={customers} />}
      />

      <UppdragList
        result={listJobsForTable({
          q: query.q,
          lifecycle: query.lifecycle,
          economy: query.economy,
          sort: query.sort,
          page: query.page,
        })}
        query={query}
      />
    </div>
  );
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
