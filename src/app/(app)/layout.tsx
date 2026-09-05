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
import { LOCAL_JSON_BUSINESS_ID } from "@/lib/collaboration/actor";
import { hydrateInvitationsFromTenant } from "@/lib/collaboration/service";
import { resolveOptionalFeatures } from "@/lib/features";
import { tenantContext } from "@/lib/storage/context";
import { requestSlot } from "@/lib/storage/request-scope";

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
  // Request-cellen är satt i Supabase-läget OCH för demosessioner (fil per
  // besökare) – annars gäller det lokala JSON-företaget.
  const businessId = requestSlot().businessId ?? tenantContext()?.businessId ?? LOCAL_JSON_BUSINESS_ID;
  hydrateInvitationsFromTenant(businessId);
  const features = resolveOptionalFeatures(db(), businessId);
  // Demoläge = lokala JSON-demon ELLER den publika demosessionen. Markören och
  // demo-menyn (redovisningsvy, återställ) visas i båda; Avsluta demo och
  // Skapa eget konto gäller bara den publika demosessionen.
  const demoSession = await isDemoSession();
  const demoBadge = !isSupabaseMode() || demoSession;
  return (
    // data-driva-demo: klientgrindar (t.ex. adressförslagens Places-laddare)
    // läser attributet och håller sig till lokala exempeldata i demon.
    <div className="min-h-dvh" data-driva-demo={demoBadge ? "1" : undefined}>
      {/*
        Appens ram följer aldrig med i en utskrift. Utan no-print trycks
        sidomenyn och bottennavet över dokumentets sidfot på varje ark – och
        varje sida i appen som går att skriva ut (avstämning, saldobalans,
        årsredovisningens A4-vy) skulle bära med sig navigeringen.
      */}
      <div className="no-print">
        <SupportModeBanner companyName={settings.name} />
      </div>
      <div className="no-print">
        <Sidebar
          companyName={settings.name}
          inboxCount={navCounts.inbox}
          bokforingCount={navCounts.bokforing}
          canLogout={canLogout}
          accountingClientCount={accountingClientCount}
          demoBadge={demoBadge}
          demoSession={demoSession}
          features={features}
        />
      </div>
      <Suspense fallback={null}>
        <NavOriginProvider />
      </Suspense>
      {/* Bottenmarginalen rymmer bottennavet + safe area så sista raden aldrig döljs. */}
      {/* Utskriften får inte bära skärmens marginal för menyerna – den är borta. */}
      <main className="pb-[calc(var(--bottom-nav-h)+env(safe-area-inset-bottom)+2.5rem)] lg:pb-16 lg:pl-60 print:p-0">
        <div className="mx-auto w-full max-w-5xl px-4 pt-6 sm:px-8 lg:pt-10 has-[[data-editor-shell]]:max-w-editor has-[[data-site-editor-shell]]:max-w-site-editor print:max-w-none print:p-0">
          {children}
        </div>
      </main>
      <div className="no-print">
        <BottomNav
          companyName={settings.name}
          canLogout={canLogout}
          inboxCount={navCounts.inbox}
          bokforingCount={navCounts.bokforing}
          demoBadge={demoBadge}
          demoSession={demoSession}
          features={features}
        />
      </div>
    </div>
  );
}
