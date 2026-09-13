import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { BokforingAdvancedTabs, BokforingSimpleChrome } from "@/components/bokforing-advanced-nav";
import { bookkeepingHasPayroll, bookkeepingMode } from "@/lib/accounting/bookkeeping-mode";
import { BOKFORING_MODE_COOKIE, parseBookkeepingMode } from "@/lib/accounting/bookkeeping-mode-keys";
import { fiscalYears, todayDate } from "@/lib/accounting/fiscal";
import { ensurePageBusiness, withBusiness } from "@/lib/auth/session";
import { ensureAutoFSkattBookings } from "@/lib/accounting/tax-account";
import { ensureBankPurchaseExpenses } from "@/lib/services/payment-matching";

/**
 * Delat bokföringsskal. Flikraden lever här så den inte monteras om när bara
 * barnvyn byts, och loading.tsx i det här segmentet lägger Suspense-gränsen
 * UNDER raden: vid flikbyte byts bara innehållsytan, aldrig chromet.
 * Första steget in i Bokföring täcks av (app)/loading.tsx.
 */
export default async function BokforingLayout({ children }: { children: ReactNode }) {
  // Nästlade layouter renderas parallellt med (app)/layout.tsx och sidan –
  // inte efter dem. Utan egen inläsning här är request-cellen tom när db()
  // läses, och i Supabase-läget (inkl. demosessionen) kastar db() då
  // "Ingen tenantkontext" för hela Bokföring. React cache() gör anropet
  // till samma inläsning som skalet och sidan redan väntar på.
  await ensurePageBusiness();
  try {
    await withBusiness(() => {
      ensureAutoFSkattBookings();
      // Bankrader som parkerades utan köp (importerade innan kortköpsgrenen
      // fanns, eller med ett förslag som sedan försvunnit) blir köp som
      // väntar på kvitto. Idempotent – ingen cron, ingen migration.
      ensureBankPurchaseExpenses();
    });
  } catch {
    // Läsande medlemskap eller saknad skrivbehörighet – F-skatten och
    // kortköpen väntar tills någon med skrivbehörighet öppnar Bokföring.
  }
  // Vyinställningen läses ur cookien som toggeln själv skriver. Företag som
  // slog på avancerat innan cookien fanns behåller sitt läge via meta-fältet.
  const jar = await cookies();
  const mode = parseBookkeepingMode(jar.get(BOKFORING_MODE_COOKIE)?.value) ?? bookkeepingMode();
  const today = todayDate();
  const openYear = fiscalYears().find((f) => f.status === "oppet");
  const showYearEnd =
    openYear != null &&
    (today >= monthsBefore(openYear.endDate, 2) || today > openYear.endDate || fiscalYears().some((f) => f.status === "stangt"));

  // Enkelt läge = en arbetskö utan flikrad; Underlag/Bank/Skatt nås som
  // drill-down från korten. Avancerat = den gemensamma redovisningsarbetsytan.
  return (
    <div className="animate-fade-up">
      {mode === "avancerat" ? (
        <BokforingAdvancedTabs initialMode={mode} hasPayroll={bookkeepingHasPayroll()} showYearEnd={showYearEnd} />
      ) : (
        <BokforingSimpleChrome />
      )}
      {children}
    </div>
  );
}

function monthsBefore(date: string, months: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - months);
  return d.toISOString().slice(0, 10);
}
