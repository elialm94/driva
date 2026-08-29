"use client";

import { useEffect, useState, useTransition } from "react";
import { AppLink } from "./app-link";
import { useRouter } from "next/navigation";
import { Hammer, Search } from "lucide-react";
import { Card, EmptyState, cx } from "./ui";
import { Pagination } from "./customer-list";
import { JobStatusBadge } from "./status";
import {
  reconcileJobListFilters,
  type JobEconomyFilter,
  type JobLifecycleFilter,
  type JobSort,
} from "@/lib/services/job-list-filters";
import type { JobListRow } from "@/lib/services/job-list";
import type { PagedResult } from "@/lib/services/customers";

export interface UppdragListQuery {
  q: string;
  lifecycle: JobLifecycleFilter;
  economy: JobEconomyFilter;
  sort: JobSort;
  page: number;
}

export function uppdragListHref(query: Partial<UppdragListQuery>): string {
  const sp = new URLSearchParams();
  sp.set("flik", "uppdrag");
  if (query.q) sp.set("q", query.q);
  if (query.lifecycle && query.lifecycle !== "aktiva") sp.set("visning", query.lifecycle);
  if (query.economy && query.economy !== "alla") sp.set("ekonomi", query.economy);
  if (query.sort && query.sort !== "standard") sp.set("sortering", query.sort);
  if (query.page && query.page > 1) sp.set("sida", String(query.page));
  return `/kunder?${sp.toString()}`;
}

const LIFECYCLE_CHIPS: [JobLifecycleFilter, string][] = [
  ["aktiva", "Aktiva"],
  ["planerade", "Planerade"],
  ["klart", "Klart"],
  ["alla", "Alla"],
];

const ECONOMY_CHIPS: [JobEconomyFilter, string][] = [
  ["kvar", "Kvar"],
  ["vantar", "Väntar"],
  ["betalt", "Betalt"],
];

export function UppdragList({
  result,
  query,
}: {
  result: PagedResult<JobListRow>;
  query: UppdragListQuery;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [q, setQ] = useState(query.q);

  useEffect(() => {
    setQ(query.q);
  }, [query.q]);

  useEffect(() => {
    const handle = setTimeout(() => {
      if (q === query.q) return;
      startTransition(() => router.replace(uppdragListHref({ ...query, q, page: 1 }), { scroll: false }));
    }, 200);
    return () => clearTimeout(handle);
  }, [q, query, router]);

  function go(patch: Partial<UppdragListQuery>) {
    const filters = reconcileJobListFilters({
      lifecycle: query.lifecycle,
      economy: query.economy,
      patch,
    });
    startTransition(() =>
      router.replace(uppdragListHref({ ...query, ...patch, ...filters }), { scroll: false }),
    );
  }

  return (
    <div className={cx(pending && "opacity-70")}>
      <div className="relative mb-4">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Sök uppdrag, kund, företag eller adress …"
          className="w-full rounded-2xl border border-line bg-card py-2.5 pl-10 pr-4 text-[15px] shadow-card placeholder:text-muted focus:border-accent"
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {LIFECYCLE_CHIPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ lifecycle: key, page: 1 })}
            className={cx(
              "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
              query.lifecycle === key
                ? "border-ink bg-ink text-white"
                : "border-line-strong text-soft hover:border-muted"
            )}
          >
            {label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-line sm:block" />
        {ECONOMY_CHIPS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => go({ economy: query.economy === key ? "alla" : key, page: 1 })}
            className={cx(
              "rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors max-lg:py-2",
              query.economy === key
                ? "border-ink bg-ink text-white"
                : "border-line text-muted hover:border-muted hover:text-soft"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {result.total === 0 ? (
        <EmptyState
          icon={Hammer}
          title={query.q || query.lifecycle !== "aktiva" || query.economy !== "alla" ? "Inga uppdrag matchar" : "Inga uppdrag ännu"}
          text={
            query.q || query.lifecycle !== "aktiva" || query.economy !== "alla"
              ? "Prova ett annat sökord eller ta bort ett filter."
              : "När en kund godkänner en offert med BankID dyker uppdraget upp här. Du kan också skapa ett själv."
          }
        />
      ) : (
        <>
          <div className="hidden md:block">
            <Card className="overflow-hidden">
              <table className="w-full text-left text-[14px]">
                <thead>
                  <tr className="border-b border-line/80 text-[12px] font-medium uppercase tracking-wide text-muted">
                    <th className="px-3 py-2.5 font-medium">Uppdrag</th>
                    <SortTh
                      label="Kund"
                      active={query.sort === "kund"}
                      onClick={() => go({ sort: query.sort === "kund" ? "standard" : "kund", page: 1 })}
                    />
                    <SortTh
                      label="När"
                      active={query.sort === "datum"}
                      onClick={() => go({ sort: query.sort === "datum" ? "standard" : "datum", page: 1 })}
                    />
                    <SortTh
                      label="Ekonomi"
                      active={query.sort === "belopp"}
                      onClick={() => go({ sort: query.sort === "belopp" ? "standard" : "belopp", page: 1 })}
                    />
                    <th className="px-3 py-2.5 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((job) => (
                    <tr key={job.id} className="relative border-b border-line/60 last:border-0 hover:bg-canvas/70">
                      <td className="px-3 py-2.5">
                        <AppLink href={`/uppdrag/${job.id}`} className="absolute inset-0" aria-label={job.title} />
                        <span className="block truncate font-medium text-ink">{job.title}</span>
                        {job.address ? (
                          <span className="mt-0.5 block truncate text-[12px] text-muted">{job.address}</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-soft">{job.customerName}</td>
                      <td className="px-3 py-2.5 text-soft">{job.whenLabel}</td>
                      <td className="px-3 py-2.5 tabular text-ink">{job.economyLabel}</td>
                      <td className="px-3 py-2.5">
                        <JobStatusBadge
                          status={job.lifecycle}
                          startDate={job.startDate}
                          completedAt={job.completedAt}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </div>

          <div className="divide-y divide-line/70 overflow-hidden rounded-[1.25rem] border border-line bg-card shadow-card md:hidden">
            {result.rows.map((job) => (
              <AppLink
                key={job.id}
                href={`/uppdrag/${job.id}`}
                className="flex items-start justify-between gap-3 px-4 py-3 hover:bg-canvas/70"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-medium">{job.title}</p>
                  <p className="mt-0.5 truncate text-[13px] text-muted">
                    {job.customerName}
                    {job.whenLabel ? ` · ${job.whenLabel}` : ""}
                  </p>
                  <p className="mt-0.5 text-[13px] tabular text-soft">{job.economyLabel}</p>
                </div>
                <JobStatusBadge
                  status={job.lifecycle}
                  startDate={job.startDate}
                  completedAt={job.completedAt}
                />
              </AppLink>
            ))}
          </div>

          <Pagination result={result} onPage={(page) => go({ page })} />
        </>
      )}
    </div>
  );
}

function SortTh({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <th className="px-3 py-2.5">
      <button
        type="button"
        onClick={onClick}
        className={cx("font-medium transition-colors hover:text-ink", active ? "text-ink" : "text-muted")}
      >
        {label}
        {active ? <span className="ml-1 text-muted">↓</span> : null}
      </button>
    </th>
  );
}
