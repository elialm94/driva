import Link from "next/link";
import { notFound } from "next/navigation";
import {
  assignTicketToMeAction,
  setTicketAdminNotesAction,
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
import { signedSupportAttachmentUrl } from "@/lib/platform/ticket-attachments";

export const metadata = { title: "Supportärende" };

const PRIMARY_STATUS: SupportTicketStatus[] = ["open", "in_progress", "resolved"];

export default async function TicketDetailPage(props: PageProps<"/admin/support/[id]">) {
  const ctx = await requirePlatformAdmin();
  const { id } = await props.params;
  const ticket = await supportTicketById(id);
  if (!ticket) notFound();

  const admins = await listPlatformAdmins();
  const assigned = admins.find((a) => a.userId === ticket.assignedAdminId);
  const resolvedBy = ticket.resolvedBy ? admins.find((a) => a.userId === ticket.resolvedBy) : undefined;
  const mine = ticket.assignedAdminId === ctx.admin.userId;
  const signedUrl = ticket.attachmentPath ? await signedSupportAttachmentUrl(ticket.attachmentPath) : null;
  const attachmentHref =
    signedUrl || (ticket.attachmentPath ? `/api/admin/support-bilaga/${ticket.id}` : ticket.attachmentDataUrl);
  const attachmentIsImage =
    Boolean(ticket.attachmentDataUrl?.startsWith("data:image/")) ||
    /\.(png|jpe?g|webp|gif)$/i.test(ticket.attachmentName ?? "");

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
          <AdminCard title="Meddelande">
            <div className="px-4 py-3">
              <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-neutral-200">
                {maskPersonnummer(ticket.message)}
              </p>
              {ticket.attachmentName ? (
                <div className="mt-3 border-t border-neutral-800 pt-3">
                  <p className="text-[12px] text-neutral-500">Bilaga</p>
                  {attachmentHref && attachmentIsImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={attachmentHref}
                      alt={ticket.attachmentName}
                      className="mt-2 max-h-96 rounded-lg border border-neutral-800"
                    />
                  ) : null}
                  {attachmentHref ? (
                    <a
                      href={attachmentHref}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex text-[13px] text-amber-300 hover:underline"
                    >
                      {ticket.attachmentName}
                    </a>
                  ) : (
                    <p className="mt-1 text-[13px] text-neutral-400">{ticket.attachmentName}</p>
                  )}
                </div>
              ) : null}
            </div>
          </AdminCard>

          <AdminCard title="Status">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {PRIMARY_STATUS.map((s) => (
                <ActionButton
                  key={s}
                  action={setTicketStatusAction}
                  fields={{ ticketId: ticket.id, status: s }}
                  variant={s === ticket.status ? "primary" : "secondary"}
                >
                  {SUPPORT_TICKET_STATUS_LABEL[s]}
                </ActionButton>
              ))}
              {ticket.status !== "waiting_for_customer" ? (
                <ActionButton
                  action={setTicketStatusAction}
                  fields={{ ticketId: ticket.id, status: "waiting_for_customer" }}
                >
                  Väntar på kund
                </ActionButton>
              ) : null}
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

          <AdminCard title="Intern anteckning">
            <div className="px-4 py-3">
              <StateForm action={setTicketAdminNotesAction} className="flex flex-col gap-2">
                <input type="hidden" name="ticketId" value={ticket.id} />
                <textarea
                  name="notes"
                  rows={3}
                  defaultValue={ticket.adminNotes ?? ""}
                  placeholder="Bara synlig för Driva Admin"
                  className={adminTextareaClass}
                />
                <div>
                  <PendingButton variant="secondary">Spara anteckning</PendingButton>
                </div>
              </StateForm>
            </div>
          </AdminCard>

          {ticket.businessId ? (
            <AdminCard title="Starta supportläge (öppna som kund)">
              <div className="px-4 py-3">
                <p className="text-[12.5px] leading-relaxed text-neutral-500">
                  Öppnar kundens Driva i den kontext ärendet gäller. Sessionen är tidsbegränsad
                  (60 min), kräver ett skäl och allt du ändrar auditeras med ditt namn.
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
          <AdminCard title="Kontext">
            <KeyValueList
              rows={[
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
                      {ticket.userName || ticket.userEmail}
                    </Link>
                  ) : (
                    ticket.userName || "–"
                  ),
                },
                { label: "E-post", value: ticket.userEmail || "–" },
                { label: "Skickat", value: datumTidKort(ticket.createdAt) },
                { label: "Sida", value: <code className="text-[12px]">{ticket.route || "–"}</code> },
                { label: "Miljö", value: ticket.environment || "–" },
                { label: "Uppdaterat", value: datumTidKort(ticket.updatedAt) },
                { label: "Löst", value: ticket.resolvedAt ? datumTidKort(ticket.resolvedAt) : "–" },
                { label: "Löst av", value: resolvedBy ? resolvedBy.name || resolvedBy.email : "–" },
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
