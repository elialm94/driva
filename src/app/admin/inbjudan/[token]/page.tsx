import Link from "next/link";
import { acceptAdminInviteAction } from "@/app/admin/actions";
import { PendingButton, StateForm } from "@/components/admin/forms";
import { peekPlatformInvitation } from "@/lib/platform/admins";
import { getPlatformSessionUser } from "@/lib/platform/auth";
import { datumTidKort } from "@/components/admin/ui";

export const metadata = { title: "Admin-inbjudan · Driva" };
export const dynamic = "force-dynamic";

/**
 * Acceptsida för admin-inbjudan. Publik väg i proxyn (mottagaren saknar ofta
 * konto), men själva accepten kräver en verifierad inloggning vars e-post
 * matchar inbjudan – token ensam ger ingen behörighet.
 */
export default async function AdminInvitePage(props: PageProps<"/admin/inbjudan/[token]">) {
  const { token } = await props.params;
  const [invitation, user] = await Promise.all([
    peekPlatformInvitation(decodeURIComponent(token)),
    getPlatformSessionUser(),
  ]);

  return (
    <div className="flex min-h-dvh items-center justify-center bg-neutral-950 px-4 text-neutral-100">
      <div className="w-full max-w-md rounded-xl border border-neutral-800 bg-neutral-900 p-6">
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-lg bg-amber-400 text-[13px] font-bold text-neutral-950">
            DA
          </span>
          <h1 className="text-[16px] font-semibold">Inbjudan till Driva Admin</h1>
        </div>

        {!invitation ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-400">
            Länken är ogiltig. Be den som bjöd in dig att skicka en ny inbjudan.
          </p>
        ) : invitation.status === "revoked" ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-400">
            Inbjudan är återkallad och kan inte användas.
          </p>
        ) : invitation.status === "accepted" ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-400">
            Inbjudan är redan använd.{" "}
            <Link href="/admin" className="text-amber-300 hover:underline">
              Öppna Driva Admin →
            </Link>
          </p>
        ) : invitation.status === "expired" ? (
          <p className="mt-3 text-[13.5px] leading-relaxed text-neutral-400">
            Inbjudan gick ut {datumTidKort(invitation.expiresAt)}. Be en superadmin skicka en ny.
          </p>
        ) : (
          <div className="mt-3 space-y-3 text-[13.5px] leading-relaxed text-neutral-400">
            <p>
              {invitation.invitedByName || "En superadmin"} har bjudit in{" "}
              <span className="font-medium text-neutral-200">{invitation.email}</span> som
              administratör (rollen Admin) i Drivas interna adminverktyg. Giltig till{" "}
              {datumTidKort(invitation.expiresAt)}.
            </p>
            {!user ? (
              <>
                <p>
                  Logga in – eller skapa ett Driva-konto – med exakt den e-postadressen, och kom
                  sedan tillbaka till den här länken.
                </p>
                <Link
                  href={
                    (`/login?next=${encodeURIComponent(`/admin/inbjudan/${token}`)}`) as never
                  }
                  className="inline-flex h-9 items-center rounded-lg bg-amber-400 px-4 text-[13px] font-semibold text-neutral-950"
                >
                  Logga in för att acceptera
                </Link>
              </>
            ) : user.email.trim().toLowerCase() !== invitation.email.trim().toLowerCase() ? (
              <p>
                Du är inloggad som <span className="text-neutral-200">{user.email}</span>, men
                inbjudan gäller {invitation.email}. Logga ut och logga in med rätt konto.
              </p>
            ) : (
              <StateForm action={acceptAdminInviteAction}>
                <input type="hidden" name="token" value={decodeURIComponent(token)} />
                <PendingButton variant="primary">Acceptera och öppna Driva Admin</PendingButton>
              </StateForm>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
