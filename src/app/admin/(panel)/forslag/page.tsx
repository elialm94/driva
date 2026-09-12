import { requirePlatformAdmin } from "@/lib/platform/auth";
import { listRecentSuggestionEvents } from "@/lib/platform/store";
import { platformOverview } from "@/lib/platform/metrics";
import { suggestionQualityReport, type DecisionCounts } from "@/lib/platform/suggestion-quality";
import { MERCHANT_TYPE_LABEL, RISK_FLAG_LABEL, type MerchantType, type RiskFlag } from "@/lib/banking/merchants";
import { AdminBadge, AdminCard, AdminTable, KeyValueList, StatCard, Th, Td } from "@/components/admin/ui";

export const metadata = { title: "Förslagskvalitet" };

const WINDOW_DAYS = 30;
const TIER_LABEL = { saker: "Säker", troligt: "Troligt", osakert: "Osäkert" } as const;

const SOURCE_LABEL: Record<string, string> = {
  match: "Faktura/OCR",
  supplier_payment: "Leverantörsbetalning",
  tax_reduction_payout: "ROT/RUT-utbetalning",
  credit_refund: "Återbetalning kreditfaktura",
  regel: "Företagets regel",
  verifikation: "Redan bokförd verifikation",
  monster: "Textmönster",
  kunskapsbas: "Kunskapsbas (motpart)",
  kvitto: "Kvitto",
  ingen: "Inget förslag",
};

function pct(v: number | null): string {
  return v == null ? "–" : `${Math.round(v * 100)} %`;
}

function CountsRow({ label, counts }: { label: string; counts: DecisionCounts }) {
  const fp = counts.falsePositiveRate;
  return (
    <tr>
      <Td>{label}</Td>
      <Td className="tabular-nums">{counts.total}</Td>
      <Td className="tabular-nums">{counts.auto}</Td>
      <Td className="tabular-nums">{counts.accepted}</Td>
      <Td className="tabular-nums">{counts.changed}</Td>
      <Td className="tabular-nums">{counts.rejected}</Td>
      <Td className="tabular-nums">{counts.private}</Td>
      <Td className="tabular-nums">
        {fp == null ? "–" : <AdminBadge tone={fp > 0.2 ? "danger" : fp > 0.05 ? "warn" : "ok"}>{pct(fp)}</AdminBadge>}
      </Td>
    </tr>
  );
}

function CountsHead() {
  return (
    <tr>
      <Th>Grupp</Th>
      <Th>Beslut</Th>
      <Th>Auto</Th>
      <Th>Godkända</Th>
      <Th>Ändrade</Th>
      <Th>Avvisade</Th>
      <Th>Privat</Th>
      <Th>Falskt positiva</Th>
    </tr>
  );
}

export default async function AdminSuggestionQualityPage() {
  await requirePlatformAdmin();
  const [events, overview] = await Promise.all([listRecentSuggestionEvents(WINDOW_DAYS), platformOverview()]);
  const report = suggestionQualityReport(events, WINDOW_DAYS);
  const o = report.overall;

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold tracking-tight text-white">Förslagskvalitet</h1>
        <p className="mt-0.5 text-[13px] text-neutral-500">
          Bankklassificeringens förslag de senaste {WINDOW_DAYS} dagarna, aggregerat över alla företag. Loggen
          innehåller aldrig motpart, belopp eller dokumentinnehåll – bara källa, nivå, beslut, riskflaggor och
          versioner. Falskt positiv = förslag som visades som Säker/Troligt men som människan ändrade, avvisade eller
          markerade som privat.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Beslut" value={o.total} />
        <StatCard label="Bokförda automatiskt" value={o.auto} sub={o.total > 0 ? pct(o.auto / o.total) : undefined} />
        <StatCard label="Godkända av människa" value={o.accepted} />
        <StatCard
          label="Falskt positiva"
          value={pct(o.falsePositiveRate)}
          tone={o.falsePositiveRate == null ? "neutral" : o.falsePositiveRate > 0.2 ? "danger" : o.falsePositiveRate > 0.05 ? "warn" : "ok"}
          sub="andel av Säker/Troligt"
        />
        <StatCard
          label="Ändrade eller privat"
          value={o.changed + o.private}
          tone={o.changed + o.private > 0 ? "warn" : "neutral"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <AdminCard title="Per nivå">
          <AdminTable head={<CountsHead />}>
            {(["saker", "troligt", "osakert"] as const).map((tier) => (
              <CountsRow key={tier} label={TIER_LABEL[tier]} counts={report.byTier[tier]} />
            ))}
          </AdminTable>
        </AdminCard>

        <AdminCard title="Per källa">
          {report.bySource.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-neutral-500">Inga beslut loggade i perioden.</p>
          ) : (
            <AdminTable head={<CountsHead />}>
              {report.bySource.map((row) => (
                <CountsRow key={row.source} label={SOURCE_LABEL[row.source] ?? row.source} counts={row.counts} />
              ))}
            </AdminTable>
          )}
        </AdminCard>

        <AdminCard title="Per motpartstyp (kunskapsbasen)">
          {report.byMerchantType.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-neutral-500">Inga beslut med känd motpartstyp.</p>
          ) : (
            <AdminTable head={<CountsHead />}>
              {report.byMerchantType.map((row) => (
                <CountsRow
                  key={row.merchantType}
                  label={MERCHANT_TYPE_LABEL[row.merchantType as MerchantType] ?? row.merchantType}
                  counts={row.counts}
                />
              ))}
            </AdminTable>
          )}
        </AdminCard>

        <AdminCard title="Krävde människa (riskflaggor)">
          {report.humanRequired.length === 0 ? (
            <p className="px-4 py-3 text-[13px] text-neutral-500">Inga riskflaggor i perioden.</p>
          ) : (
            <AdminTable
              head={
                <tr>
                  <Th>Flagga</Th>
                  <Th>Antal</Th>
                </tr>
              }
            >
              {report.humanRequired.map((row) => (
                <tr key={row.flag}>
                  <Td>{RISK_FLAG_LABEL[row.flag as RiskFlag] ?? row.flag}</Td>
                  <Td className="tabular-nums">{row.count}</Td>
                </tr>
              ))}
            </AdminTable>
          )}
        </AdminCard>

        <AdminCard title="LLM-lager och kostnad">
          <KeyValueList
            rows={[
              {
                label: "Beslut utan LLM (deterministiska)",
                value: report.llm.withoutLlm,
              },
              { label: "Beslut med LLM", value: report.llm.withLlm },
              ...report.byProvider
                .filter((p) => p.provider !== "deterministisk")
                .map((p) => ({
                  label: `Falskt positiva – ${p.provider}`,
                  value: pct(p.counts.falsePositiveRate),
                })),
              { label: "AI-anrop 30 d (hela plattformen)", value: overview.ai.calls30d },
              { label: "AI-fel 30 d", value: overview.ai.errors30d },
              {
                label: "Uppskattad AI-kostnad 30 d",
                value: overview.ai.estimatedCostUsd30d == null ? "Ingen data" : `${overview.ai.estimatedCostUsd30d.toFixed(2)} USD`,
              },
              { label: "Kunskapsbasversioner i perioden", value: report.kbVersions.join(", ") || "–" },
            ]}
          />
        </AdminCard>

        <AdminCard title="Beloppsspann">
          <KeyValueList
            rows={[
              { label: "Under 500 kr", value: report.amountBuckets.under_500 },
              { label: "500–5 000 kr", value: report.amountBuckets["500_5000"] },
              { label: "Över 5 000 kr", value: report.amountBuckets.over_5000 },
            ]}
          />
        </AdminCard>
      </div>
    </div>
  );
}
