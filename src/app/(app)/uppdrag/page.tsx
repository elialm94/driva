import { db } from "@/lib/store";
import { PageHeader } from "@/components/ui";
import { NewUppdragButton } from "@/components/uppdrag-form";
import { UppdragList, type UppdragListQuery } from "@/components/uppdrag-list";
import { listJobsForTable, type JobEconomyFilter, type JobLifecycleFilter, type JobSort } from "@/lib/services/job-list";

export const metadata = { title: "Uppdrag" };

function str(value: string | string[] | undefined): string {
  return typeof value === "string" ? value : "";
}

function parseLifecycle(value: string): JobLifecycleFilter {
  return value === "planerade" || value === "klart" || value === "alla" ? value : "aktiva";
}

function parseEconomy(value: string): JobEconomyFilter {
  return value === "kvar" || value === "vantar" || value === "betalt" ? value : "alla";
}

function parseSort(value: string): JobSort {
  return value === "datum" || value === "kund" || value === "belopp" ? value : "standard";
}

export default async function UppdragPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const searchParams = await props.searchParams;
  const query: UppdragListQuery = {
    q: str(searchParams.q),
    lifecycle: parseLifecycle(str(searchParams.visning)),
    economy: parseEconomy(str(searchParams.ekonomi)),
    sort: parseSort(str(searchParams.sortering)),
    page: Number(str(searchParams.sida)) || 1,
  };
  const customers = [...db().customers]
    .sort((a, b) => a.name.localeCompare(b.name, "sv"))
    .map((c) => ({ id: c.id, name: c.name, kind: c.kind }));

  return (
    <div className="animate-fade-up">
      <PageHeader
        title="Uppdrag"
        subtitle="Vad som är beställt, när det sker, vad som är fakturerat och vad som är kvar."
        actions={customers.length > 0 ? <NewUppdragButton customers={customers} /> : undefined}
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
