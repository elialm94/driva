import type { ReactNode } from "react";
import { Suspense } from "react";
import { Sidebar, BottomNav } from "@/components/nav";
import { NavOriginProvider } from "@/components/nav-origin";
import { SupportModeBanner } from "@/components/support-mode-banner";
import { db } from "@/lib/store";
import { getNavAttentionCounts } from "@/lib/services/nav-counts";
import { ensurePageBusiness, getSessionUser, isDemoSession, listMemberships } from "@/lib/auth/session";
import { isAccountingRole } from "@/lib/collaboration/permissions";
import { isSupabaseMode } from "@/lib/storage/config";
import { isWebsiteNavVisible } from "@/lib/services/modules";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  await ensurePageBusiness();
  const data = db();
  const settings = data.settings;
  const websiteNavVisible = isWebsiteNavVisible(settings, data);
  // Logga ut visas bara när riktiga sessioner finns (Supabase-läge).
  const canLogout = isSupabaseMode();
  const user = await getSessionUser();
  const accountingClientCount = user
    ? (await listMemberships(user.id)).filter((m) => isAccountingRole(m.role)).length
    : 0;
  const navCounts = getNavAttentionCounts();
  // Demoläge = lokala JSON-demon ELLER den publika demosessionen. Markören
  // visas i båda; Avsluta demo/Skapa eget konto gäller bara riktiga sessioner.
  const demoSession = await isDemoSession();
  const demoBadge = !isSupabaseMode() || demoSession;
  // Demon får samma konsult-genväg som lokala demon (Anna-vyn via Samarbeta).
  const accountantDemoSwitch = !isSupabaseMode() || demoSession;
  return (
    <div className="min-h-dvh">
      <SupportModeBanner companyName={settings.name} />
      <Sidebar
        companyName={settings.name}
        inboxCount={navCounts.inbox}
        bokforingCount={navCounts.bokforing}
        canLogout={canLogout}
        accountingClientCount={Math.max(accountingClientCount, accountantDemoSwitch ? 1 : 0)}
        localAccountantDemo={accountantDemoSwitch}
        demoBadge={demoBadge}
        demoSession={demoSession}
        websiteNavVisible={websiteNavVisible}
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
        localAccountantDemo={accountantDemoSwitch}
        demoBadge={demoBadge}
        demoSession={demoSession}
        websiteNavVisible={websiteNavVisible}
      />
    </div>
  );
}
