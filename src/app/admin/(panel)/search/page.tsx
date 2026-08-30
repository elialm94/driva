import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { searchBusinesses, searchUsers } from "@/lib/platform/directory";
import { listSupportTickets } from "@/lib/platform/store";
import { AdminBadge, AdminCard, TicketStatusBadge, tidSedan } from "@/components/admin/ui";

export const metadata = { title: "Sök" };

/**
 * Global admin-sök: användare (e-post/namn), företag (namn/orgnr/e-post/ägare)
 * och supportärenden. Medvetet enkel – tre riktade serversökningar med tak,
 * ingen universalsökmotor (spec §29).
 */
export default async function AdminSearchPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();
  const sp = await props.searchParams;
  const q = (typeof sp.q === "string" ? sp.q : "").trim();

  const [users, businesses, tickets] = q
    ? await Promise.all([
        searchUsers({ q, limit: 10 }),
        searchBusinesses({ q, limit: 10 }),
        listSupportTickets({ q, limit: 10 }),
      ])
    : [{ rows: [], total: 0 }, { rows: [], total: 0 }, []];

  const empty = q && users.rows.length === 0 && businesses.rows.length === 0 && tickets.length === 0;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Sök</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          {q ? (
            <>
              Resultat för <span className="text-neutral-300">”{q}”</span>
            </>
          ) : (
            "Skriv i sökfältet ovan: e-post, företagsnamn, organisationsnummer eller ärendetext."
          )}
        </p>
      </header>

      {empty ? (
        <p className="rounded-xl border border-neutral-800 bg-neutral-900 px-4 py-8 text-center text-[13px] text-neutral-500">
          Ingenting matchade ”{q}”.
        </p>
      ) : null}

      {businesses.rows.length > 0 ? (
        <AdminCard
          title={`Företag (${businesses.total})`}
          right={
            <Link
              href={(`/admin/businesses?q=${encodeURIComponent(q)}`) as never}
              className="text-[12px] text-amber-300 hover:underline"
            >
              Alla träffar →
            </Link>
          }
        >
          <ul className="divide-y divide-neutral-800/70">
            {businesses.rows.map((b) => (
              <li key={b.id}>
                <Link
                  href={(`/admin/businesses/${b.id}`) as never}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/40"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-100">
                    {b.name || "(namnlöst)"}
                  </span>
                  <span className="hidden text-[12.5px] tabular-nums text-neutral-500 sm:block">
                    {b.orgNumber || "–"}
                  </span>
                  <span className="hidden max-w-52 truncate text-[12.5px] text-neutral-500 md:block">
                    {b.ownerEmail}
                  </span>
                  {b.disabledAt ? <AdminBadge tone="danger">Inaktiverat</AdminBadge> : null}
                  {b.isDemo ? <AdminBadge tone="warn">Demo</AdminBadge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </AdminCard>
      ) : null}

      {users.rows.length > 0 ? (
        <AdminCard
          title={`Användare (${users.total})`}
          right={
            <Link
              href={(`/admin/users?q=${encodeURIComponent(q)}`) as never}
              className="text-[12px] text-amber-300 hover:underline"
            >
              Alla träffar →
            </Link>
          }
        >
          <ul className="divide-y divide-neutral-800/70">
            {users.rows.map((u) => (
              <li key={u.id}>
                <Link
                  href={(`/admin/users/${u.id}`) as never}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/40"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-100">
                    {u.email || u.id}
                  </span>
                  <span className="text-[12.5px] tabular-nums text-neutral-500">
                    {u.membershipCount} företag
                  </span>
                  {u.emailConfirmedAt ? null : <AdminBadge tone="warn">Overifierad</AdminBadge>}
                </Link>
              </li>
            ))}
          </ul>
        </AdminCard>
      ) : null}

      {tickets.length > 0 ? (
        <AdminCard title={`Supportärenden (${tickets.length})`}>
          <ul className="divide-y divide-neutral-800/70">
            {tickets.map((t) => (
              <li key={t.id}>
                <Link
                  href={(`/admin/support/${t.id}`) as never}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-neutral-800/40"
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-neutral-100">
                    {t.subject || "(utan ämne)"}
                  </span>
                  <span className="hidden max-w-44 truncate text-[12.5px] text-neutral-500 sm:block">
                    {t.businessName || t.userEmail}
                  </span>
                  <span className="text-[12px] tabular-nums text-neutral-500">{tidSedan(t.createdAt)}</span>
                  <TicketStatusBadge status={t.status} />
                </Link>
              </li>
            ))}
          </ul>
        </AdminCard>
      ) : null}
    </div>
  );
}
