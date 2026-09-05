import Link from "next/link";
import { AccountantFilters } from "@/components/accountant-filters";
import { AccountantQueue } from "@/components/accountant-queue";
import { AccountantClientTabs, accountantStatusText } from "@/components/accountant-workspace";
import { CommandBar } from "@/components/command-bar";
import { PageHeader } from "@/components/ui";
import { loadAccountantClientPage } from "@/lib/collaboration/client-page";
import { accountantActionHref } from "@/lib/collaboration/portfolio";
import { matchesAccountantFilter, type AccountantFilter } from "@/lib/collaboration/issues";
import { accountantCommandBarPrefetch } from "@/lib/services/command-bar";

export const metadata = { title: "Arbeta" };

const FILTERS: AccountantFilter[] = ["alla", "forsenat", "moms", "underlag", "bank", "granskning", "vantar"];

export default async function ClientWorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ businessId: string }>;
  searchParams: Promise<{ sak?: string; filter?: string }>;
}) {
  const { businessId } = await params;
  const { filter: rawFilter } = await searchParams;
  const { access, snap } = await loadAccountantClientPage(businessId);
  const filter = (FILTERS.includes(rawFilter as AccountantFilter) ? rawFilter : "alla") as AccountantFilter;
  const pool = filter === "vantar" ? snap.waiting : filter === "alla" ? snap.queue : [...snap.queue, ...snap.waiting];
  const items = pool
    .filter((a) => matchesAccountantFilter(a, filter))
    .map((a) => ({ ...a, href: accountantActionHref(businessId, a) }));

  const filterCounts: Partial<Record<AccountantFilter, number>> = {
    forsenat: snap.queue.filter((a) => matchesAccountantFilter(a, "forsenat")).length,
    moms: snap.queue.filter((a) => matchesAccountantFilter(a, "moms")).length,
    bank: snap.queue.filter((a) => matchesAccountantFilter(a, "bank")).length,
    underlag: snap.queue.filter((a) => matchesAccountantFilter(a, "underlag")).length,
    granskning: snap.queue.filter((a) => matchesAccountantFilter(a, "granskning")).length,
    vantar: snap.waiting.length,
  };

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
      <CommandBar
        prefetch={accountantCommandBarPrefetch("current", snap.name)}
        variant="accountant"
      />
      <AccountantClientTabs businessId={businessId} active="arbeta" />
      <AccountantFilters
        active={filter}
        counts={filterCounts}
        hrefFor={(key) =>
          key === "alla" ? `/redovisning/k/${businessId}` : `/redovisning/k/${businessId}?filter=${key}`
        }
      />
      <AccountantQueue
        title="Arbeta"
        items={items}
        initialVisible={20}
        empty={
          <p className="rounded-xl border border-line bg-card px-4 py-6 text-[14px] text-soft">
            {filter === "vantar"
              ? "Inget väntar på kunden just nu."
              : "✓ Allt klart — Inget behöver din hjälp just nu."}
          </p>
        }
      />
      {access.role === "auditor" ? (
        <p className="mt-4 text-[12px] text-muted">Revisor – endast läsning. Ändringar är blockerade.</p>
      ) : null}
      {/* Övertagandet hör till klienten, inte till kön: det görs en gång. */}
      <footer className="mt-8 border-t border-line/70 pt-6">
        <Link
          href={`/redovisning/k/${businessId}/ingaende-balans` as never}
          className="text-[13px] font-medium text-accent hover:underline"
        >
          Ingående balans och övertagande från annat program
        </Link>
      </footer>
    </div>
  );
}
