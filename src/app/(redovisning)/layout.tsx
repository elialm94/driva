import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AccountantScopeSync } from "@/components/accountant-scope-sync";
import { RedovisningMobileHeader, RedovisningMobileNav, RedovisningSidebar } from "@/components/redovisning-shell";
import { getSessionUser, isDemoSession, listMemberships } from "@/lib/auth/session";
import { LOCAL_JSON_ACCOUNTANT_ID } from "@/lib/collaboration/actor";
import { isAccountingRole, isOwnerRole } from "@/lib/collaboration/permissions";
import { listAccountantClients } from "@/lib/collaboration/clients";
import { userById } from "@/lib/collaboration/registry";
import { isSupabaseMode } from "@/lib/storage/config";

export const dynamic = "force-dynamic";

export default async function RedovisningLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user && isSupabaseMode()) redirect("/login?next=/redovisning");
  const userId = user?.id;
  if (!userId) redirect("/login?next=/redovisning");

  const memberships = await listMemberships(userId);
  const accounting = memberships.filter((m) => isAccountingRole(m.role));
  if (accounting.length === 0) {
    if (!isSupabaseMode()) redirect("/dev/som-konsult");
    redirect("/");
  }

  const clients = listAccountantClients(userId).map((c) => ({ id: c.businessId, name: c.businessName }));
  const profile = userById(userId);
  // Publika demosessionen ser redovisningsytan som Anna-vyn – tillbaka till
  // ägarvyn går alltid (demo-aktörskakan släpps, samma verifierade session).
  const demoSession = await isDemoSession();
  const canSwitchToOwner =
    memberships.some((m) => isOwnerRole(m.role)) ||
    (!isSupabaseMode() && userId === LOCAL_JSON_ACCOUNTANT_ID) ||
    demoSession;

  return (
    <div className="min-h-dvh">
      <Suspense fallback={null}>
        <AccountantScopeSync />
      </Suspense>
      <RedovisningSidebar
        userName={profile?.name || user.name || user.email}
        clientCount={clients.length}
        canSwitchToOwner={canSwitchToOwner}
        clients={clients}
        canLogout={isSupabaseMode()}
        demoBadge={!isSupabaseMode() || demoSession}
        demoSession={demoSession}
      />
      <main className="pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+2.5rem)] lg:pb-16 lg:pl-60">
        <RedovisningMobileHeader clients={clients} />
        <div className="mx-auto max-w-6xl px-4 pt-4 sm:px-8 lg:pt-8">{children}</div>
      </main>
      <RedovisningMobileNav />
    </div>
  );
}
