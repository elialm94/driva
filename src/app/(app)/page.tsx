import { getBusinessActions } from "@/lib/services/actions";
import { projectHomeAttention } from "@/lib/services/action-views";
import { halsning, datumUtanAr, veckodag, isoNow } from "@/lib/format";
import { SectionTitle } from "@/components/ui";
import { AttentionEmptyCard, AttentionSection } from "@/components/attention-list";
import { WatchingList } from "@/components/watching-list";
import { CommandBar } from "@/components/command-bar";
import { commandBarPrefetch } from "@/lib/services/command-bar";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Hem" };

/** Så många åtgärder visas direkt – resten bakom "Visa fler". */
const HOME_ATTENTION_VISIBLE = 5;

function safeHomeActions() {
  try {
    return getBusinessActions();
  } catch (err) {
    console.error("[hem] åtgärdsmotorn:", err instanceof Error ? err.message : err);
    return { attention: [], watching: [] };
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

export default async function HomePage() {
  await ensurePageBusiness();
  const actions = safeHomeActions();
  // Prioriterad vy – samma åtgärds-id:n som Bokföring, inte en komplett kö.
  const attention = projectHomeAttention(actions.attention);
  const now = isoNow();

  return (
    <div className="animate-fade-up">
      <p className="text-sm font-medium text-muted">
        {veckodag(now)} {datumUtanAr(now)}
      </p>
      <h1 className="mt-1 text-[28px] font-semibold tracking-tight">{halsning()}</h1>

      <CommandBar prefetch={safeCommandPrefetch()} variant="hem" />

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
    </div>
  );
}
