import { CommandBar } from "@/components/command-bar";
import { AccountantFilters } from "@/components/accountant-filters";
import { AccountantQueue } from "@/components/accountant-queue";
import { SwitchClientRow } from "@/components/switch-client-row";
import { PageHeader } from "@/components/ui";
import { getSessionUser } from "@/lib/auth/session";
import { accountantCommandBarPrefetch } from "@/lib/services/command-bar";
import {
  clientRowStatus,
  landingHeadline,
  queueCounts,
  searchClients,
} from "@/lib/collaboration/clients";
import {
  loadAccountantPortfolio,
  portfolioQueue,
  upcomingVatDeadlines,
} from "@/lib/collaboration/portfolio";
import { matchesAccountantFilter, type AccountantFilter } from "@/lib/collaboration/issues";
import { userById } from "@/lib/collaboration/registry";
import { datumKort, halsning } from "@/lib/format";

export const metadata = { title: "Redovisning" };

const FILTERS: AccountantFilter[] = ["alla", "forsenat", "moms", "underlag", "bank", "granskning", "vantar"];

export default async function RedovisningHomePage({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string; q?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) return null;
  const params = await searchParams;
  const filter = (FILTERS.includes(params.filter as AccountantFilter) ? params.filter : "alla") as AccountantFilter;
  const q = (params.q ?? "").trim();
  const profile = userById(user.id);
  const firstName = profile?.name?.split(" ")[0] || user.name?.split(" ")[0] || "";

  const portfolio = await loadAccountantPortfolio(user.id);
  const merged = portfolioQueue(portfolio, filter);
  const allActive = portfolioQueue(portfolio, "alla");
  const counts = queueCounts(allActive);
  const deadlines = upcomingVatDeadlines(portfolio, 7);
  const queueItems = merged.map((i) => i.action);

  const filterCounts: Partial<Record<AccountantFilter, number>> = {
    forsenat: allActive.filter((i) => matchesAccountantFilter(i.action, "forsenat")).length,
    moms: allActive.filter((i) => matchesAccountantFilter(i.action, "moms")).length,
    bank: allActive.filter((i) => matchesAccountantFilter(i.action, "bank")).length,
    underlag: allActive.filter((i) => matchesAccountantFilter(i.action, "underlag")).length,
    granskning: allActive.filter((i) => matchesAccountantFilter(i.action, "granskning")).length,
    vantar: portfolioQueue(portfolio, "vantar").length,
  };

  const clientRows = (q ? searchClients(user.id, q) : portfolio.map((s) => s.membership)).map((m) => {
    const snap = portfolio.find((s) => s.membership.businessId === m.businessId);
    return {
      id: m.businessId,
      name: snap?.name ?? m.businessName,
      status: snap
        ? clientRowStatus(snap.summary, {
            vatDueDays: snap.nextVat && snap.nextVat.days >= 0 ? snap.nextVat.days : null,
            bankOk: snap.bankOk,
          })
        : "Klart ✓",
    };
  });

  const empty =
    counts.items === 0 ? (
      <p className="rounded-xl border border-line bg-card px-4 py-6 text-[14px] text-soft">
        ✓ Allt klart — Inget behöver din hjälp just nu.
      </p>
    ) : (
      <p className="text-[13px] text-soft">Inget i det här filtret.</p>
    );

  return (
    <div className="animate-fade-up">
      <PageHeader
        title={`${halsning()} ${firstName}`.trim()}
        subtitle={landingHeadline(counts.items, counts.clients)}
      />

      <CommandBar prefetch={accountantCommandBarPrefetch("all_clients")} variant="accountant" />

      <AccountantFilters
        active={filter}
        counts={filterCounts}
        hrefFor={(key) => (key === "alla" ? "/redovisning" : `/redovisning?filter=${key}`)}
      />

      {deadlines.length > 0 ? (
        <div className="mb-5 rounded-xl border border-line bg-card px-3 py-2.5">
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Denna vecka</p>
          <ul className="space-y-0.5 text-[13px] text-ink">
            {deadlines.map((d) => (
              <li key={`${d.businessId}-${d.dueDate}`}>
                {d.businessName} · Moms · {datumKort(d.dueDate)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <AccountantQueue title="Arbeta" items={queueItems} initialVisible={16} empty={empty} />

      <div className="mt-10">
        <div className="mb-2 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-muted">Klienter</h2>
            <p className="text-[12px] text-soft">{portfolio.length} företag</p>
          </div>
        </div>
        <form className="mb-2">
          {filter !== "alla" ? <input type="hidden" name="filter" value={filter} /> : null}
          <input
            name="q"
            defaultValue={q}
            placeholder="Sök klient…"
            className="w-full max-w-md rounded-lg border border-line px-3 py-1.5 text-[13px]"
          />
        </form>
        <div className="overflow-hidden rounded-xl border border-line bg-card">
          {clientRows.map((r) => (
            <SwitchClientRow key={r.id} businessId={r.id} name={r.name} status={r.status} />
          ))}
          {clientRows.length === 0 ? <p className="px-3 py-4 text-[13px] text-soft">Inga klienter matchar.</p> : null}
        </div>
      </div>
    </div>
  );
}
