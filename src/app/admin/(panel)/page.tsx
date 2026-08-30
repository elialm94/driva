import Link from "next/link";
import { AdminCard, KeyValueList, StatCard, TrendBars } from "@/components/admin/ui";
import { platformOverview } from "@/lib/platform/metrics";

export const metadata = { title: "Översikt" };

/**
 * Driftöversikten. Alla siffror kommer från EN central definitionsmodul
 * (src/lib/platform/metrics.ts) – aldrig egna beräkningar per komponent.
 * Endast mätvärden som kan härledas ur riktig data visas; fakturering/
 * MRR/ARR finns inte i produkten och fejkas därför inte (spec §31).
 */
export default async function AdminOverviewPage() {
  const m = await platformOverview();
  const pct = (v: number | null) => (v == null ? "Okänd" : `${Math.round(v * 100)} %`);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Översikt</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Idag (UTC), rullande fönster där det anges. Demoföretag ingår inte i KPI:erna.
        </p>
      </header>

      {/* IDAG */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Nya konton idag" value={m.today.newUsers} />
        <StatCard label="Nya företag idag" value={m.today.newBusinesses} />
        <StatCard label="Aktiva företag idag" value={m.today.activeBusinesses} />
        <StatCard
          label="Öppna supportärenden"
          value={m.support.open}
          tone={m.support.open > 0 ? "warn" : "neutral"}
          sub={
            m.support.oldestOpenHours != null ? `äldsta: ${m.support.oldestOpenHours} h` : undefined
          }
        />
        <StatCard
          label="Fel senaste dygnet"
          value={m.today.failures24h}
          tone={m.today.failures24h > 0 ? "danger" : "ok"}
          sub="mejl + AI"
        />
      </div>

      {/* Trender (14 dagar) */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <TrendBars label="Registreringar" points={m.trends.signups} />
        <TrendBars label="Nya företag" points={m.trends.businesses} />
        <TrendBars label="Offerter skapade" points={m.trends.quotes} />
        <TrendBars label="Fakturor utfärdade" points={m.trends.invoicesIssued} />
        <TrendBars label="Dokument behandlade" points={m.trends.documentsProcessed} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <AdminCard title="Anskaffning">
          <KeyValueList
            rows={[
              { label: "Användare totalt", value: m.acquisition.usersTotal },
              {
                label: "Företag totalt",
                value: `${m.acquisition.businessesTotal} (${m.acquisition.demoBusinesses} demo)`,
              },
              { label: "Registreringar 7/30 d", value: `${m.acquisition.signups7d} / ${m.acquisition.signups30d}` },
              { label: "Nya företag 7/30 d", value: `${m.acquisition.businesses7d} / ${m.acquisition.businesses30d}` },
              { label: "Slutförd onboarding", value: pct(m.acquisition.onboardingConversion) },
            ]}
          />
        </AdminCard>

        <AdminCard title="Engagemang (30 d)">
          <KeyValueList
            rows={[
              {
                label: "Aktiva företag 7/30 d",
                value: `${m.engagement.activeBusinesses7d} / ${m.engagement.activeBusinesses30d}`,
              },
              { label: "Offerter skapade", value: m.engagement.quotes30d },
              { label: "Fakturor utfärdade", value: m.engagement.invoicesIssued30d },
              { label: "Uppdrag skapade", value: m.engagement.jobs30d },
            ]}
          />
        </AdminCard>

        <AdminCard title="Automation (30 d)">
          <KeyValueList
            rows={[
              { label: "Dokument behandlade", value: m.automation.documentsProcessed30d },
              { label: "Verifikationer bokförda", value: m.automation.verificationsPosted30d },
              {
                label: "Varav automatiska",
                value: `${m.automation.verificationsAuto30d} (${pct(m.automation.autoShare30d)})`,
              },
            ]}
          />
        </AdminCard>

        <AdminCard title="AI (30 d)">
          <KeyValueList
            rows={[
              { label: "Anrop", value: m.ai.calls30d },
              { label: "Fel", value: m.ai.errors30d },
              {
                label: "Uppskattad kostnad",
                value: m.ai.estimatedCostUsd30d == null ? "Okänd" : `$${m.ai.estimatedCostUsd30d.toFixed(2)}`,
              },
            ]}
          />
        </AdminCard>

        <AdminCard title="Transaktionsmejl (30 d)">
          <KeyValueList
            rows={[
              { label: "Skickade", value: m.email.sent30d },
              { label: "Misslyckade", value: m.email.failed30d },
            ]}
          />
        </AdminCard>

        <AdminCard
          title="Support"
          right={
            <Link href="/admin/support" className="text-[12px] text-amber-300 hover:underline">
              Till kön →
            </Link>
          }
        >
          <KeyValueList
            rows={[
              { label: "Nya", value: m.support.open },
              { label: "Pågående", value: m.support.inProgress },
              { label: "Väntar på kund", value: m.support.waiting },
              { label: "Lösta totalt", value: m.support.resolvedTotal },
              {
                label: "Äldsta öppna",
                value: m.support.oldestOpenHours == null ? "–" : `${m.support.oldestOpenHours} h`,
              },
            ]}
          />
        </AdminCard>
      </div>
    </div>
  );
}
