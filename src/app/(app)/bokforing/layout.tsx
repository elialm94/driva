import type { ReactNode } from "react";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { bookkeepingHasPayroll, bookkeepingMode } from "@/lib/accounting/bookkeeping-mode";
import { fiscalYears, todayDate } from "@/lib/accounting/fiscal";
import { ensurePageBusiness } from "@/lib/auth/session";

/**
 * Delat bokföringsskal. Flikraden lever här så den inte monteras om när
 * bara barnvyn byts. Ingen loading.tsx i det här segmentet: en sådan gräns
 * byter ut hela innehållet mot OverviewSkeleton vid varje flikbyte.
 * Första steget in i Bokföring täcks av (app)/loading.tsx.
 */
export default async function BokforingLayout({ children }: { children: ReactNode }) {
  // Nästlade layouter renderas parallellt med (app)/layout.tsx och sidan –
  // inte efter dem. Utan egen inläsning här är request-cellen tom när db()
  // läses, och i Supabase-läget (inkl. demosessionen) kastar db() då
  // "Ingen tenantkontext" för hela Bokföring. React cache() gör anropet
  // till samma inläsning som skalet och sidan redan väntar på.
  await ensurePageBusiness();
  const today = todayDate();
  const openYear = fiscalYears().find((f) => f.status === "oppet");
  const showYearEnd =
    openYear != null &&
    (today >= monthsBefore(openYear.endDate, 2) || today > openYear.endDate || fiscalYears().some((f) => f.status === "stangt"));

  return (
    <div className="animate-fade-up">
      <BokforingAdvancedTabs
        mode={bookkeepingMode()}
        hasPayroll={bookkeepingHasPayroll()}
        showYearEnd={showYearEnd}
      />
      {children}
    </div>
  );
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
