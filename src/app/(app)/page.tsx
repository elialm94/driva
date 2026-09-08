import { getBusinessActions, type BusinessActions } from "@/lib/services/actions";
import { projectHomeAttention } from "@/lib/services/action-views";
import { halsning, datumUtanAr, veckodag, isoNow } from "@/lib/format";
import { SectionTitle } from "@/components/ui";
import { AttentionEmptyCard, AttentionSection } from "@/components/attention-list";
import { HomeReminders } from "@/components/home-reminders";
import { WatchingList } from "@/components/watching-list";
import { CommandBar } from "@/components/command-bar";
import { commandBarPrefetch } from "@/lib/services/command-bar";
import { ensurePageBusiness } from "@/lib/auth/session";
import { setupSummary, type SetupSummary } from "@/lib/setup/tasks";
import { SetupHomeCard } from "@/components/setup/setup-home-card";
import { HomeMoneyStrip } from "@/components/home-money-strip";
import { businessStats, financeOverview } from "@/lib/services/finance";

export const metadata = { title: "Hem" };

/** Så många åtgärder visas direkt – resten bakom "Visa fler". */
const HOME_ATTENTION_VISIBLE = 5;

function safeHomeActions() {
  try {
    return getBusinessActions();
  } catch (err) {
    console.error("[hem] åtgärdsmotorn:", err instanceof Error ? err.message : err);
    return { attention: [], watching: [], reminders: [] } satisfies BusinessActions;
  }
}

function safeSetupSummary(): SetupSummary | null {
  try {
    return setupSummary();
  } catch (err) {
    console.error("[hem] kom igång:", err instanceof Error ? err.message : err);
    return null;
  }
}

function safeCommandPrefetch() {
  try {
    return commandBarPrefetch();
  } catch (err) {
    console.error("[hem] kommandofält:", err instanceof Error ? err.message : err);
    return { aiConfigured: false, quickActions: [], recentCustomers: [], activeJobs: [], recentInvoices: [] };
  }
}

function safeFinance() {
  try {
    return financeOverview();
  } catch (err) {
    console.error("[hem] pengar:", err instanceof Error ? err.message : err);
    return {
      bank: 0,
      moms: 0,
      momsDue: "",
      fSkatt: 0,
      payrollReserve: 0,
      taxAccount: 0,
      reserved: 0,
      upcoming: 0,
      upcomingRows: [],
      available: 0,
    };
  }
}

function safeStats() {
  try {
    return businessStats();
  } catch (err) {
    console.error("[hem] nyckeltal:", err instanceof Error ? err.message : err);
    return { unpaidSum: 0, overdueSum: 0 };
  }
}

export default async function HomePage() {
  await ensurePageBusiness();
  const actions = safeHomeActions();
  // Prioriterad vy – samma åtgärds-id:n som Bokföring, inte en komplett kö.
  const attention = projectHomeAttention(actions.attention);
  const now = isoNow();
  // Nytt/ofullständigt företag: "Gör Ferva redo" högt upp – härlett ur verklig data.
  const setup = safeSetupSummary();

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-muted">
        {veckodag(now)} {datumUtanAr(now)}
      </p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{halsning()}</h1>

      <CommandBar prefetch={safeCommandPrefetch()} variant="hem" />

      {setup ? <SetupHomeCard summary={setup} /> : null}

      <HomeMoneyStrip
        finance={safeFinance()}
        unpaid={safeStats().unpaidSum}
        overdue={safeStats().overdueSum}
      />

      <div className="mt-10">
        <AttentionSection
          title="Behöver din uppmärksamhet"
          items={attention}
          initialVisible={HOME_ATTENTION_VISIBLE}
          empty={<AttentionEmptyCard />}
        />
      </div>

      {actions.watching.length > 0 ? (
        <div className="mt-10">
          <SectionTitle>På gång</SectionTitle>
          <WatchingList items={actions.watching} />
        </div>
      ) : null}

      {actions.reminders.length > 0 ? <HomeReminders items={actions.reminders} /> : null}
    </div>
  );
}
