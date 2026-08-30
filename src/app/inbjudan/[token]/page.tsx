import { redirect } from "next/navigation";
import { buttonClasses } from "@/components/ui";
import { acceptInviteAction, continueAsInviteeAction } from "@/app/collaboration-actions";
import { getSessionUser } from "@/lib/auth/session";
import { lookupInvitation } from "@/lib/collaboration/service";
import { roleLabel } from "@/lib/collaboration/permissions";
import { isSupabaseMode } from "@/lib/storage/config";

export const metadata = { title: "Inbjudan – Driva" };
export const dynamic = "force-dynamic";

export default async function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = await lookupInvitation(token);
  const user = await getSessionUser();

  if (!invitation) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Inbjudan ogiltig</h1>
          <p className="mt-2 text-sm text-stone-600">Länken finns inte, är redan använd eller har gått ut.</p>
        </div>
      </main>
    );
  }

  if (invitation.status !== "pending") {
    if (invitation.status === "accepted" && user) redirect("/redovisning");
    return (
      <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4">
        <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
          <h1 className="text-xl font-semibold">Inbjudan kan inte användas</h1>
          <p className="mt-2 text-sm text-stone-600">
            {invitation.status === "expired"
              ? "Inbjudan har gått ut. Be ägaren skicka en ny."
              : invitation.status === "revoked"
                ? "Inbjudan är återkallad."
                : "Inbjudan är redan använd."}
          </p>
        </div>
      </main>
    );
  }

  const role = roleLabel(invitation.role);

  if (isSupabaseMode() && !user) {
    redirect(`/login?next=${encodeURIComponent(`/inbjudan/${token}`)}`);
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-stone-100 px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-stone-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-stone-500">Driva</p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">
          {invitation.invitedByName} bjuder in dig som {role.toLowerCase()}
        </h1>
        <p className="mt-2 text-sm text-stone-600">
          Du får tillgång till bokföringen för företaget. Ägaren kan ta bort åtkomsten när som helst.
        </p>

        {isSupabaseMode() ? (
          <form action={acceptInviteAction} className="mt-6 space-y-3">
            <input type="hidden" name="token" value={token} />
            <label className="block text-sm font-medium">
              Namn
              <input
                name="name"
                defaultValue={user?.name ?? ""}
                required
                className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm"
              />
            </label>
            <p className="text-xs text-stone-500">Inloggad som {user?.email}</p>
            <button type="submit" className={buttonClasses("primary")}>
              Acceptera
            </button>
          </form>
        ) : (
          <form action={continueAsInviteeAction} className="mt-6 space-y-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="email" value={invitation.email} />
            <label className="block text-sm font-medium">
              Namn
              <input name="name" defaultValue="" required className="mt-1 w-full rounded-xl border border-stone-300 px-3 py-2 text-sm" />
            </label>
            <p className="text-xs text-stone-500">Inbjudan gäller {invitation.email}</p>
            <button type="submit" className={buttonClasses("primary")}>
              Acceptera
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
