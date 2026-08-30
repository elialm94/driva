import Link from "next/link";
import { notFound } from "next/navigation";
import {
  deleteUserAction,
  disableUserAction,
  enableUserAction,
  resendVerificationAction,
} from "@/app/admin/actions";
import { ActionButton, DangerPanel } from "@/components/admin/forms";
import {
  AdminBadge,
  AdminCard,
  AdminTable,
  KeyValueList,
  Th,
  Td,
  datumTidKort,
  isBannedNow,
} from "@/components/admin/ui";
import { requirePlatformAdmin } from "@/lib/platform/auth";
import { userDeletionPolicy, userDetail } from "@/lib/platform/directory";
import { platformRoleLabel } from "@/lib/platform/types";

export const metadata = { title: "Användare" };

const ROLE_LABEL: Record<string, string> = {
  owner: "Ägare",
  admin: "Admin",
  member: "Medlem",
  accounting_consultant: "Redovisningskonsult",
  auditor: "Revisor",
};

export default async function UserDetailPage(props: PageProps<"/admin/users/[id]">) {
  await requirePlatformAdmin();
  const { id } = await props.params;
  const user = await userDetail(id);
  if (!user) notFound();
  const policy = await userDeletionPolicy(id);
  const banned = isBannedNow(user.bannedUntil);

  return (
    <div className="space-y-4">
      <header>
        <Link href="/admin/users" className="text-[12.5px] text-neutral-500 hover:text-neutral-300">
          ← Användare
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-2.5">
          <h1 className="text-[18px] font-semibold tracking-tight text-white">{user.email || user.id}</h1>
          {banned ? <AdminBadge tone="danger">Inaktiverat konto</AdminBadge> : null}
          {user.isPlatformAdmin ? (
            <AdminBadge tone="info">Plattformsadmin: {platformRoleLabel(user.platformRole ?? "")}</AdminBadge>
          ) : null}
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <AdminCard title="Företag och roller">
            {user.memberships.length === 0 ? (
              <p className="px-4 py-4 text-[13px] text-neutral-500">Inga aktiva medlemskap.</p>
            ) : (
              <AdminTable
                head={
                  <>
                    <Th>Företag</Th>
                    <Th>Roll</Th>
                    <Th>Typ</Th>
                    <Th>Sedan</Th>
                  </>
                }
              >
                {user.memberships.map((m) => (
                  <tr key={`${m.businessId}-${m.role}`} className="hover:bg-neutral-800/40">
                    <Td className="max-w-64">
                      <Link
                        href={(`/admin/businesses/${m.businessId}`) as never}
                        className="block truncate text-neutral-100 hover:underline"
                      >
                        {m.businessName || m.businessId}
                      </Link>
                    </Td>
                    <Td>{ROLE_LABEL[m.role] ?? m.role}</Td>
                    <Td>{m.isDemo ? <AdminBadge tone="warn">Demo</AdminBadge> : <AdminBadge tone="ok">Riktigt</AdminBadge>}</Td>
                    <Td className="whitespace-nowrap">
                      {m.createdAt ? datumTidKort(m.createdAt).slice(0, 10) : "–"}
                    </Td>
                  </tr>
                ))}
              </AdminTable>
            )}
          </AdminCard>

          <AdminCard title="Åtgärder">
            <div className="flex flex-wrap gap-2 px-4 py-3">
              {!user.emailConfirmedAt ? (
                <ActionButton action={resendVerificationAction} fields={{ email: user.email }}>
                  Skicka om verifieringsmejl
                </ActionButton>
              ) : null}
              {banned ? (
                <ActionButton action={enableUserAction} fields={{ userId: user.id, email: user.email }}>
                  Återställ kontot
                </ActionButton>
              ) : null}
            </div>
            {user.emailConfirmedAt && !banned ? (
              <p className="px-4 pb-3 text-[12.5px] text-neutral-500">
                Kontot är verifierat och aktivt – inga snabbåtgärder behövs.
              </p>
            ) : null}
          </AdminCard>

          {!banned ? (
            <DangerPanel
              title="Inaktivera kontot"
              buttonLabel="Inaktivera kontot"
              affects={["Användaren loggas ut och kan inte logga in igen förrän kontot återställs."]}
              preserved={["Alla företag, bokföring och data lämnas orörda."]}
              undoable="Kan ångras: kontot kan återställas när som helst."
              fields={{ userId: user.id, email: user.email }}
              action={disableUserAction}
            />
          ) : null}

          <DangerPanel
            title="Radera kontot permanent"
            buttonLabel="Radera kontot"
            affects={[
              "Auth-kontot raderas – användaren kan aldrig logga in igen.",
              ...(policy.businessesToDelete.length > 0
                ? [
                    `Tomma egna företag raderas: ${policy.businessesToDelete
                      .map((b) => b.name || b.id)
                      .join(", ")}.`,
                  ]
                : []),
              ...(policy.membershipsToRevoke > 0
                ? [`${policy.membershipsToRevoke} medlemskap i andras företag återkallas.`]
                : []),
            ]}
            preserved={policy.preserved}
            undoable="Kan INTE ångras."
            blockers={policy.blockers}
            fields={{ userId: user.id, email: user.email }}
            action={deleteUserAction}
            confirmField={{
              name: "confirmEmail",
              expected: user.email,
              label: "Skriv användarens e-postadress för att bekräfta",
            }}
          />
        </div>

        <div className="space-y-4">
          <AdminCard title="Konto">
            <KeyValueList
              rows={[
                { label: "Auth user id", value: <code className="text-[11px]">{user.id}</code> },
                { label: "E-post", value: user.email || "–" },
                {
                  label: "E-post verifierad",
                  value: user.emailConfirmedAt ? datumTidKort(user.emailConfirmedAt) : "Nej",
                },
                { label: "Registrerad", value: user.createdAt ? datumTidKort(user.createdAt) : "–" },
                {
                  label: "Senast inloggad",
                  value: user.lastSignInAt ? datumTidKort(user.lastSignInAt) : "–",
                },
                {
                  label: "Kontostatus",
                  value: banned ? `Inaktiverat till ${datumTidKort(user.bannedUntil)}` : "Aktivt",
                },
                {
                  label: "Plattformsroll",
                  value: user.isPlatformAdmin ? platformRoleLabel(user.platformRole ?? "") : "Ingen",
                },
              ]}
            />
          </AdminCard>
          <p className="px-1 text-[12px] leading-relaxed text-neutral-600">
            Lösenord och autentiseringshemligheter hanteras av Supabase Auth och visas aldrig här.
            Radering följer raderingspolicyn – bokföring och utfärdade fakturor bevaras alltid
            (bokföringslagen).
          </p>
        </div>
      </div>
    </div>
  );
}
