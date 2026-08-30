import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listSupportTickets, countSupportTicketsByStatus } from "@/lib/platform/store";
import type { SupportTicketStatus } from "@/lib/platform/types";
import { AdminCard, AdminTable, Th, Td, TicketStatusBadge, datumTidKort } from "@/components/admin/ui";
import { cx } from "@/components/ui";

export const metadata = { title: "Support" };

const TABS: { key: SupportTicketStatus | "all"; label: string }[] = [
  { key: "all", label: "Alla" },
  { key: "open", label: "Öppna" },
  { key: "in_progress", label: "Pågår" },
  { key: "waiting_for_customer", label: "Väntar" },
  { key: "resolved", label: "Lösta" },
];

export default async function AdminSupportPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();
  const sp = await props.searchParams;
  const rawStatus = typeof sp.status === "string" ? sp.status : "all";
  const tab = TABS.some((t) => t.key === rawStatus) ? rawStatus : "all";
  const statusFilter = tab === "all" ? undefined : ([tab] as SupportTicketStatus[]);

  const [tickets, counts] = await Promise.all([
    listSupportTickets({ statuses: statusFilter, limit: 100 }),
    countSupportTicketsByStatus(),
  ]);
  const total = counts.open + counts.in_progress + counts.waiting_for_customer + counts.resolved;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Support</h1>
        <nav className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={(t.key === "all" ? "/admin/support" : `/admin/support?status=${t.key}`) as never}
              className={cx(
                "rounded-md px-3 py-1.5 text-[12.5px] tabular-nums",
                tab === t.key ? "bg-neutral-700 font-medium text-white" : "text-neutral-400 hover:text-neutral-200"
              )}
            >
              {t.label} ({t.key === "all" ? total : counts[t.key]})
            </Link>
          ))}
        </nav>
      </header>

      <AdminCard>
        {tickets.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-neutral-500">Inga ärenden.</p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Datum</Th>
                <Th>Företag</Th>
                <Th>Användare</Th>
                <Th>Ärende</Th>
                <Th>Status</Th>
              </>
            }
          >
            {tickets.map((t) => (
              <tr key={t.id} className="hover:bg-neutral-800/40">
                <Td className="whitespace-nowrap tabular-nums">{datumTidKort(t.createdAt)}</Td>
                <Td className="max-w-44">
                  {t.businessId ? (
                    <Link
                      href={(`/admin/businesses/${t.businessId}`) as never}
                      className="truncate text-amber-300 hover:underline"
                    >
                      {t.businessName || t.businessId}
                    </Link>
                  ) : (
                    <span className="truncate">{t.businessName || "–"}</span>
                  )}
                </Td>
                <Td className="max-w-52">
                  {t.userId ? (
                    <Link
                      href={(`/admin/users/${t.userId}`) as never}
                      className="truncate text-amber-300 hover:underline"
                    >
                      {t.userName || t.userEmail}
                    </Link>
                  ) : (
                    <span className="truncate">{t.userEmail || "–"}</span>
                  )}
                </Td>
                <Td className="max-w-72">
                  <Link
                    href={(`/admin/support/${t.id}`) as never}
                    className="block truncate font-medium text-neutral-100 hover:underline"
                  >
                    {t.subject || "(utan ämne)"}
                  </Link>
                </Td>
                <Td>
                  <TicketStatusBadge status={t.status} />
                </Td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminCard>
    </div>
  );
}
