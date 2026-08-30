import Link from "next/link";
import { notFound } from "next/navigation";
import {
  assignTicketToMeAction,
  setTicketPriorityAction,
  setTicketStatusAction,
  startSupportSessionAction,
} from "@/app/admin/actions";
import { ActionButton, PendingButton, StateForm, adminTextareaClass } from "@/components/admin/forms";
import {
  AdminCard,
  KeyValueList,
  TicketPriorityBadge,
  TicketStatusBadge,
  datumTidKort,
  maskPersonnummer,
} from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listPlatformAdmins, supportTicketById } from "@/lib/platform/store";
import type { SupportTicketStatus } from "@/lib/platform/types";
import { SUPPORT_TICKET_STATUS_LABEL } from "@/lib/platform/types";

export const metadata = { title: "Supportärende" };

const NEXT_STATUS: SupportTicketStatus[] = ["open", "in_progress", "waiting_for_customer", "resolved"];

export default async function TicketDetailPage(props: PageProps<"/admin/support/[id]">) {
  const ctx = await requirePlatformAdmin();
  const { id } = await props.params;
  const ticket = await supportTicketById(id);
  if (!ticket) notFound();

  const admins = await listPlatformAdmins();
  const assigned = admins.find((a) => a.userId === ticket.assignedAdminId);
  const mine = ticket.assignedAdminId === ctx.admin.userId;

  return (
    <div className="space-y-4">
      <header>
        <Link href="/admin/support" className="text-[12.5px] text-neutral-500 hover:text-neutral-300">
          ← Supportkön
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="text-[18px] font-semibold tracking-tight text-white">
            {ticket.subject || "(utan ämne)"}
          </h1>
          <TicketStatusBadge status={ticket.status} />
          <TicketPriorityBadge priority={ticket.priority} />
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="space-y-4">
          <AdminCard title="Meddelande från kunden">
            <div className="px-4 py-3">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-200">
                {maskPersonnummer(ticket.message)}
              </p>
              {ticket.attachmentDataUrl ? (
                <div className="mt-3 border-t border-neutral-800 pt-3">
                  <p className="text-[12px] text-neutral-500">Bilaga: {ticket.attachmentName}</p>
                  {ticket.attachmentDataUrl.startsWith("data:image/") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={ticket.attachmentDataUrl}
                      alt={ticket.attachmentName ?? "Bilaga"}
                      className="mt-2 max-h-96 rounded-lg border border-neutral-800"
                    />
                  ) : (
                    <a
                      href={ticket.attachmentDataUrl}
                      download={ticket.attachmentName ?? "bilaga"}
                      className="mt-2 inline-flex text-[13px] text-amber-300 hover:underline"
                    >
                      Ladda ner bilagan
                    </a>
                  )}
                </div>
              ) : null}
            </div>
          </AdminCard>

          <AdminCard title="Status">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {NEXT_STATUS.filter((s) => s !== ticket.status).map((s) => (
                <ActionButton
                  key={s}
                  action={setTicketStatusAction}
                  fields={{ ticketId: ticket.id, status: s }}
                >
                  → {SUPPORT_TICKET_STATUS_LABEL[s]}
                </ActionButton>
              ))}
              <ActionButton
                action={assignTicketToMeAction}
                fields={{ ticketId: ticket.id, release: mine ? "1" : "0" }}
              >
                {mine ? "Släpp tilldelningen" : "Tilldela mig"}
              </ActionButton>
              {(["low", "normal", "high"] as const)
                .filter((p) => p !== ticket.priority)
                .map((p) => (
                  <ActionButton
                    key={p}
                    action={setTicketPriorityAction}
                    fields={{ ticketId: ticket.id, priority: p }}
                  >
                    Prioritet: {p === "low" ? "Låg" : p === "normal" ? "Normal" : "Hög"}
                  </ActionButton>
                ))}
            </div>
          </AdminCard>

          {ticket.businessId ? (
            <AdminCard title="Starta supportläge (öppna som kund)">
              <div className="px-4 py-3">
                <p className="text-[12.5px] leading-relaxed text-neutral-500">
                  Öppnar kundens Driva i exakt den kontext ärendet gäller. Sessionen är tidsbegränsad
                  (60 min), kräver ett skäl och allt du ändrar auditeras med ditt namn – aldrig
                  kundens (spec: inga kundlösenord, ingen imitation).
                </p>
                <StateForm action={startSupportSessionAction} className="mt-3 flex flex-col gap-2">
                  <input type="hidden" name="businessId" value={ticket.businessId} />
                  <input type="hidden" name="ticketId" value={ticket.id} />
                  <input type="hidden" name="route" value={ticket.route || "/"} />
                  <textarea
                    name="reason"
                    required
                    rows={2}
                    placeholder="Varför behöver du åtkomst? (loggas i auditloggen)"
                    className={adminTextareaClass}
                  />
                  <div>
                    <PendingButton variant="primary">Starta support-session</PendingButton>
                  </div>
                </StateForm>
              </div>
            </AdminCard>
          ) : null}
        </div>

        <div className="space-y-4">
          <AdminCard title="Kontext (automatiskt bifogad)">
            <KeyValueList
              rows={[
                { label: "Skapat", value: datumTidKort(ticket.createdAt) },
                { label: "Uppdaterat", value: datumTidKort(ticket.updatedAt) },
                {
                  label: "Företag",
                  value: ticket.businessId ? (
                    <Link
                      href={(`/admin/businesses/${ticket.businessId}`) as never}
                      className="text-amber-300 hover:underline"
                    >
                      {ticket.businessName || ticket.businessId}
                    </Link>
                  ) : (
                    ticket.businessName || "–"
                  ),
                },
                {
                  label: "Användare",
                  value: ticket.userId ? (
                    <Link
                      href={(`/admin/users/${ticket.userId}`) as never}
                      className="text-amber-300 hover:underline"
                    >
                      {ticket.userEmail}
                    </Link>
                  ) : (
                    ticket.userEmail
                  ),
                },
                { label: "Namn", value: ticket.userName || "–" },
                { label: "Rutt i appen", value: <code className="text-[12px]">{ticket.route || "–"}</code> },
                { label: "App-version", value: ticket.appVersion || "Okänd" },
                {
                  label: "Enhet",
                  value: (
                    <span className="break-all text-[11.5px] text-neutral-400">{ticket.userAgent || "–"}</span>
                  ),
                },
                { label: "Tilldelad", value: assigned ? assigned.name || assigned.email : "–" },
              ]}
            />
          </AdminCard>
          {ticket.businessId ? (
            <Link
              href={(`/admin/businesses/${ticket.businessId}`) as never}
              className="inline-flex h-9 items-center rounded-lg border border-neutral-700 px-4 text-[13px] font-medium text-neutral-200 hover:bg-neutral-800"
            >
              Öppna företag →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
