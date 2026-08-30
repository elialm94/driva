import Link from "next/link";
import { notFound } from "next/navigation";
import {
  disableBusinessAction,
  deleteBusinessAction,
  enableBusinessAction,
  resendAccountantInviteAction,
  startSupportSessionAction,
} from "@/app/admin/actions";
import {
  ActionButton,
  DangerPanel,
  PendingButton,
  StateForm,
  adminTextareaClass,
} from "@/components/admin/forms";
import {
  AdminBadge,
  AdminCard,
  AdminTable,
  KeyValueList,
  Th,
  Td,
  datumTidKort,
  tidSedan,
} from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import {
  businessDeletionPolicy,
  businessDetail,
  collaborationInvitesForBusiness,
} from "@/lib/platform/directory";

export const metadata = { title: "Företag" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Ägare",
  admin: "Admin",
  member: "Medlem",
  accounting_consultant: "Redovisningskonsult",
  auditor: "Revisor",
};

export default async function BusinessDetailPage(props: PageProps<"/admin/businesses/[id]">) {
  await requirePlatformAdmin();
  const { id } = await props.params;
  const [detail, invites] = await Promise.all([
    businessDetail(id),
    collaborationInvitesForBusiness(id).catch(() => []),
  ]);
  if (!detail) notFound();
  const deletionPolicy = await businessDeletionPolicy(id);
  const pendingInvites = invites.filter((i) => i.status === "pending" || i.status === "expired");

  return (
    <div className="space-y-4">
      <header>
        <Link href="/admin/businesses" className="text-[12.5px] text-neutral-500 hover:text-neutral-300">
          ← Företag
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="text-[18px] font-semibold tracking-tight text-white">
            {detail.name || "(namnlöst)"}
          </h1>
          {detail.disabledAt ? (
            <AdminBadge tone="danger">Inaktiverat {datumTidKort(detail.disabledAt).slice(0, 10)}</AdminBadge>
          ) : (
            <AdminBadge tone="ok">Aktivt</AdminBadge>
          )}
          {detail.isDemo ? <AdminBadge tone="warn">Demo</AdminBadge> : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <AdminCard title="Medlemmar">
            {detail.members.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-neutral-500">Inga aktiva medlemmar.</p>
            ) : (
              <AdminTable
                head={
                  <>
                    <Th>E-post</Th>
                    <Th>Roll</Th>
                    <Th>Sedan</Th>
                    <Th>Senast aktiv</Th>
                  </>
                }
              >
                {detail.members.map((m) => (
                  <tr key={m.userId} className="hover:bg-neutral-800/40">
                    <Td className="max-w-64">
                      <Link
                        href={(`/admin/users/${m.userId}`) as never}
                        className="block truncate text-neutral-100 hover:underline"
                      >
                        {m.email || m.userId}
                      </Link>
                    </Td>
                    <Td>{ROLE_LABEL[m.role] ?? m.role}</Td>
                    <Td className="whitespace-nowrap">
                      {m.createdAt ? datumTidKort(m.createdAt).slice(0, 10) : "–"}
                    </Td>
                    <Td className="whitespace-nowrap tabular-nums">
                      {m.lastActiveAt ? tidSedan(m.lastActiveAt) : "–"}
                    </Td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </AdminCard>

          {pendingInvites.length > 0 ? (
            <AdminCard title="Samarbetsinbjudningar">
              <AdminTable
                head={
                  <>
                    <Th>E-post</Th>
                    <Th>Roll</Th>
                    <Th>Status</Th>
                    <Th />
                  </>
                }
              >
                {pendingInvites.map((i) => (
                  <tr key={i.id}>
                    <Td className="max-w-60 truncate">{i.email}</Td>
                    <Td>{ROLE_LABEL[i.role] ?? i.role}</Td>
                    <Td>
                      {i.status === "expired" ? (
                        <AdminBadge tone="warn">Utgången</AdminBadge>
                      ) : (
                        <AdminBadge tone="info">Väntar på svar</AdminBadge>
                      )}
                    </Td>
                    <Td>
                      <ActionButton
                        action={resendAccountantInviteAction}
                        fields={{ businessId: detail.id, invitationId: i.id }}
                      >
                        Skicka om
                      </ActionButton>
                    </Td>
                  </tr>
                ))}
              </AdminTable>
            </AdminCard>
          ) : null}

          <AdminCard title="Senaste systemhändelser">
            {detail.recentEvents.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-neutral-500">Inga händelser loggade.</p>
            ) : (
              <ul className="divide-y divide-neutral-800/70">
                {detail.recentEvents.map((e, i) => (
                  <li key={`${e.at}-${i}`} className="flex items-baseline gap-3 px-4 py-2 text-[12.5px]">
                    <span className="shrink-0 tabular-nums text-neutral-500">{datumTidKort(e.at)}</span>
                    <span className="text-neutral-500">{e.eventType}</span>
                    <span className="min-w-0 truncate text-neutral-300">{e.message}</span>
                  </li>
                ))}
              </ul>
            )}
          </AdminCard>
        </div>

        <div className="space-y-4">
          <AdminCard title="Företagsdata">
            <KeyValueList
              rows={[
                { label: "Organisationsnummer", value: detail.orgNumber || "–" },
                { label: "E-post", value: detail.email || "–" },
                { label: "Telefon", value: detail.phone || "–" },
                { label: "Ort", value: detail.city || "–" },
                { label: "Skapat", value: datumTidKort(detail.createdAt) },
                {
                  label: "Senast aktivt",
                  value: detail.lastActivityAt ? datumTidKort(detail.lastActivityAt) : "–",
                },
                { label: "Företags-id", value: <code className="text-[11px]">{detail.id}</code> },
              ]}
            />
          </AdminCard>

          <AdminCard title="Användning">
            <KeyValueList
              rows={[
                { label: "Kunder", value: detail.counts.customers },
                { label: "Offerter", value: detail.counts.quotes },
                { label: "Utfärdade fakturor", value: detail.counts.issuedInvoices },
                { label: "Verifikationer", value: detail.counts.verifications },
                { label: "Uppdrag", value: detail.counts.jobs },
                { label: "Inbox-poster", value: detail.counts.inboxItems },
              ]}
            />
          </AdminCard>

          <AdminCard title="Supportläge">
            <div className="px-4 py-3">
              <p className="text-[12.5px] leading-relaxed text-neutral-500">
                Öppnar företaget i kundappen som dig själv (aldrig som kunden). Tidsbegränsat till
                60 min, kräver skäl, allt auditeras.
              </p>
              <StateForm action={startSupportSessionAction} className="mt-3 flex flex-col gap-2">
                <input type="hidden" name="businessId" value={detail.id} />
                <input type="hidden" name="route" value="/" />
                <textarea
                  name="reason"
                  required
                  rows={2}
                  placeholder="Varför behöver du åtkomst?"
                  className={adminTextareaClass}
                />
                <div>
                  <PendingButton variant="primary">Öppna som support</PendingButton>
                </div>
              </StateForm>
            </div>
          </AdminCard>

          {detail.disabledAt ? (
            <ActionButton
              action={enableBusinessAction}
              fields={{ businessId: detail.id, name: detail.name }}
            >
              Återaktivera företaget
            </ActionButton>
          ) : (
            <DangerPanel
              title="Inaktivera företaget"
              buttonLabel="Inaktivera"
              affects={[
                "Alla medlemmar förlorar åtkomsten till företaget vid nästa sidladdning.",
                "Publika offert-/fakturalänkar påverkas inte.",
              ]}
              preserved={["All data (bokföring, fakturor, kunder) behålls orörd."]}
              undoable="Kan ångras: företaget kan återaktiveras när som helst."
              fields={{ businessId: detail.id, name: detail.name }}
              action={disableBusinessAction}
            />
          )}

          <DangerPanel
            title="Radera företaget permanent"
            buttonLabel="Radera företaget"
            affects={[
              `Företaget och all dess data raderas (${detail.members.length} medlemskap avslutas).`,
              "Kunder, offerter, uppdrag och inställningar försvinner.",
            ]}
            preserved={deletionPolicy.preserved}
            undoable="Kan INTE ångras."
            blockers={deletionPolicy.blockers}
            fields={{ businessId: detail.id, name: detail.name }}
            action={deleteBusinessAction}
            confirmField={{
              name: "confirmName",
              expected: detail.name,
              label: "Skriv företagets namn för att bekräfta",
            }}
          />
        </div>
      </div>
    </div>
  );
}
