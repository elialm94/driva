import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { searchUsers } from "@/lib/platform/directory";
import {
  AdminBadge,
  AdminCard,
  AdminTable,
  PaginationLinks,
  Th,
  Td,
  datumTidKort,
  isBannedNow,
  tidSedan,
} from "@/components/admin/ui";

export const metadata = { title: "Användare" };

const PAGE_SIZE = 50;

export default async function AdminUsersPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();
  const sp = await props.searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const offset = Math.max(0, Number(typeof sp.offset === "string" ? sp.offset : 0) || 0);
  const deleted = sp.raderad === "1";

  const { rows, total } = await searchUsers({ q, limit: PAGE_SIZE, offset });

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Användare</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Alla registrerade konton (Supabase Auth). Sök på e-post, namn eller företag.
        </p>
      </header>

      {deleted ? (
        <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-[13px] text-emerald-300">
          Kontot raderades enligt raderingspolicyn.
        </p>
      ) : null}

      <form method="get" className="flex gap-2">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Sök på e-post, namn eller företagsnamn …"
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
          <p className="px-4 py-8 text-center text-[13px] text-neutral-500">Inga användare matchar.</p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>E-post</Th>
                <Th>Registrerad</Th>
                <Th>Verifierad</Th>
                <Th>Senast inloggad</Th>
                <Th className="text-right">Företag</Th>
                <Th>Status</Th>
              </>
            }
          >
            {rows.map((u) => (
              <tr key={u.id} className="hover:bg-neutral-800/40">
                <Td className="max-w-64">
                  <Link
                    href={(`/admin/users/${u.id}`) as never}
                    className="block truncate font-medium text-neutral-100 hover:underline"
                  >
                    {u.email || u.id}
                  </Link>
                </Td>
                <Td className="whitespace-nowrap">
                  {u.createdAt ? datumTidKort(u.createdAt).slice(0, 10) : "–"}
                </Td>
                <Td>
                  {u.emailConfirmedAt ? (
                    <AdminBadge tone="ok">Ja</AdminBadge>
                  ) : (
                    <AdminBadge tone="warn">Nej</AdminBadge>
                  )}
                </Td>
                <Td className="whitespace-nowrap tabular-nums">
                  {u.lastSignInAt ? tidSedan(u.lastSignInAt) : "–"}
                </Td>
                <Td className="text-right tabular-nums">{u.membershipCount}</Td>
                <Td>
                  {isBannedNow(u.bannedUntil) ? (
                    <AdminBadge tone="danger">Inaktiverat</AdminBadge>
                  ) : (
                    <AdminBadge tone="ok">Aktivt</AdminBadge>
                  )}
                </Td>
              </tr>
            ))}
          </AdminTable>
        )}
        <PaginationLinks
          basePath="/admin/users"
          params={{ q: q || undefined }}
          offset={offset}
          limit={PAGE_SIZE}
          total={total}
        />
      </AdminCard>
    </div>
  );
}
