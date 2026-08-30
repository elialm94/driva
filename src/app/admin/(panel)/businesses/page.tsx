import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { searchBusinesses, type BusinessStatusFilter } from "@/lib/platform/directory";
import {
  AdminBadge,
  AdminCard,
  AdminTable,
  PaginationLinks,
  Th,
  Td,
  datumTidKort,
  tidSedan,
} from "@/components/admin/ui";
import { cx } from "@/components/ui";

export const metadata = { title: "Företag" };

const PAGE_SIZE = 50;
const STATUS_TABS: { key: BusinessStatusFilter; label: string }[] = [
  { key: "alla", label: "Alla" },
  { key: "aktiva", label: "Aktiva" },
  { key: "inaktiverade", label: "Inaktiverade" },
  { key: "demo", label: "Demo" },
];

export default async function AdminBusinessesPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const rawStatus = typeof sp.status === "string" ? sp.status : "alla";
  const status: BusinessStatusFilter = STATUS_TABS.some((t) => t.key === rawStatus)
    ? (rawStatus as BusinessStatusFilter)
    : "alla";
  const offset = Math.max(0, Number(typeof sp.offset === "string" ? sp.offset : 0) || 0);
  const deleted = sp.raderad === "1";

  const { rows, total } = await searchBusinesses({ q, status, limit: PAGE_SIZE, offset });

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Företag</h1>
        <nav className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {STATUS_TABS.map((t) => (
            <Link
              key={t.key}
              href={
                (`/admin/businesses?status=${t.key}${q ? `&q=${encodeURIComponent(q)}` : ""}`) as never
              }
              className={cx(
                "rounded-md px-3 py-1.5 text-[12.5px]",
                status === t.key ? "bg-neutral-700 font-medium text-white" : "text-neutral-400 hover:text-neutral-200"
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
      </header>

      {deleted ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          Företaget raderades.
        </p>
      ) : null}

      <form method="get" className="flex gap-2">
        <input type="hidden" name="status" value={status} />
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Sök på företagsnamn, organisationsnummer, e-post eller ägare …"
          className="h-9 w-full max-w-lg rounded-lg border border-neutral-700 bg-neutral-900 px-3 text-[13px] text-neutral-100 placeholder:text-neutral-600 focus:border-neutral-500 focus:outline-none"
        />
        <button
          type="submit"
          className="h-9 rounded-lg border border-neutral-700 px-3 text-[13px] text-neutral-200 hover:bg-neutral-800"
        >
          Sök
        </button>
      </form>

      <AdminCard>
        {rows.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-neutral-500">Inga företag matchar.</p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Företag</Th>
                <Th>Orgnr</Th>
                <Th>Ägare</Th>
                <Th>Skapat</Th>
                <Th>Senast aktivt</Th>
                <Th className="text-right">Medl.</Th>
                <Th>Status</Th>
              </>
            }
          >
            {rows.map((b) => (
              <tr key={b.id} className="hover:bg-neutral-800/40">
                <Td className="max-w-60">
                  <Link
                    href={(`/admin/businesses/${b.id}`) as never}
                    className="block truncate font-medium text-neutral-100 hover:underline"
                  >
                    {b.name || "(namnlöst)"}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{b.orgNumber || "–"}</Td>
                <Td className="max-w-52 truncate">{b.ownerEmail || "–"}</Td>
                <Td className="whitespace-nowrap">{datumTidKort(b.createdAt).slice(0, 10)}</Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {b.lastActivityAt ? tidSedan(b.lastActivityAt) : "–"}
                </Td>
                <Td className="text-right tabular-nums">{b.memberCount}</Td>
                <Td>
                  <span className="flex gap-1">
                    {b.disabledAt ? (
                      <AdminBadge tone="danger">Inaktiverat</AdminBadge>
                    ) : (
                      <AdminBadge tone="ok">Aktivt</AdminBadge>
                    )}
                    {b.isDemo ? <AdminBadge tone="warn">Demo</AdminBadge> : null}
                  </span>
                </Td>
              </tr>
            ))}
          </AdminTable>
        )}
        <PaginationLinks
          basePath="/admin/businesses"
          params={{ q: q || undefined, status }}
          offset={offset}
          limit={PAGE_SIZE}
          total={total}
        />
      </AdminCard>
    </div>
  );
}
