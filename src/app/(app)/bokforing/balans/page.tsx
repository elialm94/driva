import { kr, datumLang } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { balansrapport, type BalansRad } from "@/lib/accounting/ledger";

export const metadata = { title: "Balansrapport" };

function Rows({ rows }: { rows: BalansRad[] }) {
  return (
    <>
      {rows.map((r) => (
        <tr key={r.account} className="border-t border-line/50">
          <td className="py-1.5 pr-3">
            <span className="font-mono text-[12px] text-muted">{r.account}</span> {r.name}
          </td>
          <td className="py-1.5 text-right tabular">{kr(r.amount)}</td>
        </tr>
      ))}
    </>
  );
}

export default function BalansPage() {
  const br = balansrapport();

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/bokforing" fallbackLabel="Bokföring" />}
        title="Balansrapport"
        subtitle={`Vad företaget äger och är skyldigt per ${datumLang(br.atDate)}.`}
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/bokforing/export?typ=balans" className="text-[13px] font-medium text-accent hover:underline">
              Exportera CSV
            </a>
            <PrintButton />
          </div>
        }
      />
      <BokforingAdvancedTabs />

      {/* Ägarvänlig sammanfattning */}
      <Card className="mb-6 px-6 py-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[13px] text-muted">Företaget äger</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">{kr(br.sumTillgangar)}</p>
            <p className="text-[12px] text-soft">pengar, fordringar och inventarier</p>
          </div>
          <div>
            <p className="text-[13px] text-muted">Företaget är skyldigt</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">{kr(br.sumSkulder)}</p>
            <p className="text-[12px] text-soft">moms, skatt och leverantörer</p>
          </div>
          <div>
            <p className="text-[13px] text-muted">Eget kapital</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">{kr(br.sumEgetKapital)}</p>
            <p className="text-[12px] text-soft">företagets eget värde</p>
          </div>
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="overflow-x-auto px-5 py-4">
          <h3 className="text-[15px] font-semibold">Tillgångar</h3>
          <table className="mt-2 w-full text-[13px]">
            <tbody>
              <Rows rows={br.tillgangar} />
              <tr className="border-t border-line font-semibold">
                <td className="py-2">Summa tillgångar</td>
                <td className="py-2 text-right tabular">{kr(br.sumTillgangar)}</td>
              </tr>
            </tbody>
          </table>
        </Card>

        <Card className="overflow-x-auto px-5 py-4">
          <h3 className="text-[15px] font-semibold">Eget kapital och skulder</h3>
          <table className="mt-2 w-full text-[13px]">
            <tbody>
              <Rows rows={br.egetKapital} />
              {br.beraknatResultat !== 0 ? (
                <tr className="border-t border-line/50">
                  <td className="py-1.5 pr-3 text-soft">Beräknat resultat (året pågår – bokförs vid bokslut)</td>
                  <td className="py-1.5 text-right tabular">{kr(br.beraknatResultat)}</td>
                </tr>
              ) : null}
              <tr className="border-t border-line font-medium">
                <td className="py-2">Summa eget kapital</td>
                <td className="py-2 text-right tabular">{kr(br.sumEgetKapital)}</td>
              </tr>
              <Rows rows={br.skulder} />
              <tr className="border-t border-line font-medium">
                <td className="py-2">Summa skulder</td>
                <td className="py-2 text-right tabular">{kr(br.sumSkulder)}</td>
              </tr>
              <tr className="border-t-2 border-line font-semibold">
                <td className="py-2.5">Summa eget kapital och skulder</td>
                <td className="py-2.5 text-right tabular">{kr(br.sumEgetKapital + br.sumSkulder)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      </div>

      <p className="mt-4 text-[12px] text-muted">
        {br.differens === 0
          ? "✓ Balansen stämmer: tillgångarna är lika stora som eget kapital plus skulder."
          : `⚠ Balansen skiljer sig med ${kr(br.differens)} – kontakta support.`}
      </p>
    </div>
  );
}
