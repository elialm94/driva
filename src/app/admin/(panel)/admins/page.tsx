import {
  disableAdminAction,
  enableAdminAction,
  inviteAdminAction,
  removeAdminAction,
  resendAdminInviteAction,
  revokeAdminInviteAction,
} from "@/app/admin/actions";
import { ActionButton, PendingButton, StateForm, adminInputClass } from "@/components/admin/forms";
import { AdminBadge, AdminCard, AdminTable, Th, Td, datumTidKort } from "@/components/admin/ui";
import { getPlatformAdmin } from "@/lib/platform/auth";
import { listAdminTeam } from "@/lib/platform/admins";
import { platformRoleLabel, SUPER_ADMIN } from "@/lib/platform/types";

export const metadata = { title: "Admins" };

/**
 * Teamhantering – ENDAST super_admin. Sidan döljer sig för andra, men den
 * riktiga spärren sitter i varje server action (requireSuperAdmin) och i
 * tjänstelagret + databastriggern (sista super_admin kan aldrig försvinna).
 */
export default async function AdminTeamPage() {
  const ctx = await getPlatformAdmin();
  if (!ctx || ctx.admin.role !== SUPER_ADMIN) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900 p-6 text-[13.5px] text-neutral-400">
        <h1 className="text-[16px] font-semibold text-white">403 – Endast super_admin</h1>
        <p className="mt-2">
          Admin-teamet hanteras av super_admin. Din roll ({platformRoleLabel(ctx?.admin.role ?? "")})
          ger inte behörighet här – och servern nekar även direkta anrop.
        </p>
      </div>
    );
  }

  const { admins, invitations } = await listAdminTeam();
  const activeSupers = admins.filter((a) => a.role === SUPER_ADMIN && !a.disabledAt).length;
  const openInvitations = invitations.filter((i) => i.status === "pending" || i.status === "expired");

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Admins</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Plattformsteamet. Inbjudningar ger alltid rollen Admin – super_admin utses endast via
          bootstrap-skriptet på servern (se docs/admin.md).
        </p>
      </header>

      <AdminCard title="Bjud in admin">
        <StateForm action={inviteAdminAction} className="flex flex-wrap items-end gap-2 px-4 py-3">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-[12.5px] text-neutral-400">
            E-postadress
            <input
              type="email"
              name="email"
              required
              placeholder="namn@driva.se"
              className={adminInputClass}
            />
          </label>
          <PendingButton variant="primary">Bjud in admin</PendingButton>
        </StateForm>
        <p className="border-t border-neutral-800 px-4 py-2.5 text-[12px] text-neutral-600">
          Engångslänk via mejl, giltig 7 dagar. Mottagaren loggar in (eller skapar konto) med exakt
          den adressen och blir Admin – aldrig Superadmin.
        </p>
      </AdminCard>

      <AdminCard title={`Teamet (${admins.length})`}>
        <AdminTable
          head={
            <>
              <Th>Namn</Th>
              <Th>E-post</Th>
              <Th>Roll</Th>
              <Th>Sedan</Th>
              <Th>Status</Th>
              <Th />
            </>
          }
        >
          {admins.map((a) => {
            const isSelf = a.userId === ctx.admin.userId;
            const lastSuper = a.role === SUPER_ADMIN && !a.disabledAt && activeSupers <= 1;
            return (
              <tr key={a.id} className="hover:bg-neutral-800/40">
                <Td className="max-w-44 truncate font-medium text-neutral-100">
                  {a.name || "–"}
                  {isSelf ? <span className="ml-1.5 text-[11px] text-neutral-500">(du)</span> : null}
                </Td>
                <Td className="max-w-56 truncate">{a.email}</Td>
                <Td>
                  {a.role === SUPER_ADMIN ? (
                    <AdminBadge tone="warn">Superadmin</AdminBadge>
                  ) : (
                    <AdminBadge tone="info">Admin</AdminBadge>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{datumTidKort(a.createdAt).slice(0, 10)}</Td>
                <Td>
                  {a.disabledAt ? (
                    <AdminBadge tone="danger">Inaktiverad</AdminBadge>
                  ) : (
                    <AdminBadge tone="ok">Aktiv</AdminBadge>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    {a.disabledAt ? (
                      <ActionButton action={enableAdminAction} fields={{ adminId: a.id }}>
                        Återaktivera
                      </ActionButton>
                    ) : lastSuper ? (
                      <span className="text-[11.5px] text-neutral-600">
                        Sista aktiva superadmin – skyddad
                      </span>
                    ) : (
                      <>
                        <ActionButton
                          action={disableAdminAction}
                          fields={{ adminId: a.id }}
                          confirmText={`Inaktivera ${a.email}? Personen förlorar åtkomsten till Driva Admin direkt.`}
                        >
                          Inaktivera
                        </ActionButton>
                        <ActionButton
                          action={removeAdminAction}
                          fields={{ adminId: a.id }}
                          variant="danger"
                          confirmText={`Ta bort ${a.email} permanent från admin-teamet? Auditloggen bevaras. Detta kan inte ångras.`}
                        >
                          Ta bort
                        </ActionButton>
                      </>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </AdminTable>
      </AdminCard>

      {openInvitations.length > 0 ? (
        <AdminCard title={`Öppna inbjudningar (${openInvitations.length})`}>
          <AdminTable
            head={
              <>
                <Th>E-post</Th>
                <Th>Inbjuden av</Th>
                <Th>Går ut</Th>
                <Th>Status</Th>
                <Th />
              </>
            }
          >
            {openInvitations.map((i) => (
              <tr key={i.id}>
                <Td className="max-w-56 truncate">{i.email}</Td>
                <Td className="max-w-44 truncate">{i.invitedByName}</Td>
                <Td className="whitespace-nowrap">{datumTidKort(i.expiresAt).slice(0, 10)}</Td>
                <Td>
                  {i.status === "expired" ? (
                    <AdminBadge tone="warn">Utgången</AdminBadge>
                  ) : (
                    <AdminBadge tone="info">Väntar på svar</AdminBadge>
                  )}
                </Td>
                <Td>
                  <div className="flex flex-wrap justify-end gap-1.5">
                    <ActionButton action={resendAdminInviteAction} fields={{ invitationId: i.id }}>
                      Skicka om
                    </ActionButton>
                    <ActionButton
                      action={revokeAdminInviteAction}
                      fields={{ invitationId: i.id }}
                      variant="danger"
                      confirmText={`Återkalla inbjudan till ${i.email}? Länken slutar fungera direkt.`}
                    >
                      Återkalla
                    </ActionButton>
                  </div>
                </Td>
              </tr>
            ))}
          </AdminTable>
        </AdminCard>
      ) : null}

      <p className="px-1 text-[12px] leading-relaxed text-neutral-600">
        Skydd: Admin kan aldrig skapa, inaktivera, ta bort eller nedgradera en Superadmin – varken
        via UI:t eller genom direkta serveranrop. Den sista aktiva Superadmin kan inte tas bort
        eller inaktiveras (spärr i tjänstelagret och databastriggern). Varje teamändring skrivs till
        den oföränderliga auditloggen.
      </p>
    </div>
  );
}
