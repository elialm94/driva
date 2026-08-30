import Link from "next/link";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listSupportTickets, countSupportTicketsByStatus, listPlatformAdmins } from "@/lib/platform/store";
import type { SupportTicketStatus } from "@/lib/platform/types";
import {
  AdminCard,
  AdminTable,
  Th,
  Td,
  TicketPriorityBadge,
  tidSedan,
} from "@/components/admin/ui";
import { cx } from "@/components/ui";

export const metadata = { title: "Support" };

const TABS: { key: SupportTicketStatus; label: string }[] = [
  { key: "open", label: "Nya" },
  { key: "in_progress", label: "Pågående" },
  { key: "waiting_for_customer", label: "Väntar" },
  { key: "resolved", label: "Klart" },
];

export default async function AdminSupportPage(props: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requirePlatformAdmin();
  const sp = await props.searchParams;
  const rawStatus = typeof sp.status === "string" ? sp.status : "open";
  const status: SupportTicketStatus = TABS.some((t) => t.key === rawStatus)
    ? (rawStatus as SupportTicketStatus)
    : "open";

  const [tickets, counts, admins] = await Promise.all([
    listSupportTickets({ statuses: [status], limit: 100 }),
    countSupportTicketsByStatus(),
    listPlatformAdmins(),
  ]);
  const adminName = (userId?: string) => {
    if (!userId) return "–";
    const a = admins.find((x) => x.userId === userId);
    return a ? a.name || a.email : "Okänd admin";
  };

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Support</h1>
        <nav className="flex gap-1 rounded-lg border border-neutral-800 bg-neutral-900 p-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={(`/admin/support?status=${t.key}`) as never}
              className={cx(
                "rounded-md px-3 py-1.5 text-[12.5px] tabular-nums",
                status === t.key ? "bg-neutral-700 font-medium text-white" : "text-neutral-400 hover:text-neutral-200"
              )}
            >
              {t.label} ({counts[t.key]})
            </Link>
          ))}
        </nav>
      </header>

      <AdminCard>
        {tickets.length === 0 ? (
          <p className="px-4 py-8 text-center text-[13px] text-neutral-500">
            Inga ärenden med statusen {TABS.find((t) => t.key === status)?.label.toLowerCase()}.
          </p>
        ) : (
          <AdminTable
            head={
              <>
                <Th>Ärende</Th>
                <Th>Företag</Th>
                <Th>Användare</Th>
                <Th>Prioritet</Th>
                <Th>Ålder</Th>
                <Th>Tilldelad</Th>
              </>
            }
          >
            {tickets.map((t) => (
              <tr key={t.id} className="hover:bg-neutral-800/40">
                <Td className="max-w-72">
                  <Link
                    href={(`/admin/support/${t.id}`) as never}
                    className="block truncate font-medium text-neutral-100 hover:underline"
                  >
                    {t.subject || "(utan ämne)"}
                  </Link>
                </Td>
                <Td className="max-w-44 truncate">{t.businessName || "–"}</Td>
                <Td className="max-w-52 truncate">{t.userEmail}</Td>
                <Td>
                  <TicketPriorityBadge priority={t.priority} />
                </Td>
                <Td className="whitespace-nowrap tabular-nums">{tidSedan(t.createdAt)}</Td>
                <Td className="max-w-40 truncate">{adminName(t.assignedAdminId)}</Td>
              </tr>
            ))}
          </AdminTable>
        )}
      </AdminCard>
    </div>
  );
}
