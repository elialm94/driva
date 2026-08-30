import type { ReactNode } from "react";
import { Suspense } from "react";
import { Sidebar, BottomNav } from "@/components/nav";
import { NavOriginProvider } from "@/components/nav-origin";
import { db } from "@/lib/store";
import { getNavAttentionCounts } from "@/lib/services/nav-counts";
import { ensurePageBusiness, getSessionUser, listMemberships } from "@/lib/auth/session";
import { isAccountingRole } from "@/lib/collaboration/permissions";
import { isSupabaseMode } from "@/lib/storage/config";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await ensurePageBusiness();
  const settings = db().settings;
  // Logga ut visas bara när riktiga sessioner finns (Supabase-läge).
  const canLogout = isSupabaseMode();
  const user = await getSessionUser();
  const accountingClientCount = user
    ? (await listMemberships(user.id)).filter((m) => isAccountingRole(m.role)).length
    : 0;
  const navCounts = getNavAttentionCounts();
  return (
    <div className="min-h-dvh">
      <Sidebar
        companyName={settings.name}
        inboxCount={navCounts.inbox}
        bokforingCount={navCounts.bokforing}
        canLogout={canLogout}
        accountingClientCount={Math.max(accountingClientCount, isSupabaseMode() ? 0 : 1)}
        localAccountantDemo={!isSupabaseMode()}
      />
      <Suspense fallback={null}>
        <NavOriginProvider />
      </Suspense>
      {/* Bottenmarginalen rymmer bottennavet + safe area så sista raden aldrig döljs. */}
      <main className="pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+2.5rem)] lg:pb-16 lg:pl-60">
        <div className="mx-auto max-w-5xl px-4 pt-6 sm:px-8 lg:pt-10">{children}</div>
      </main>
      <BottomNav
        canLogout={canLogout}
        inboxCount={navCounts.inbox}
        bokforingCount={navCounts.bokforing}
        localAccountantDemo={!isSupabaseMode()}
      />
    </div>
  );
}
