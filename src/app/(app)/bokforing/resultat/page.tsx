import { kr } from "@/lib/format";
import { Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";
import { resultatrapport } from "@/lib/accounting/ledger";
import { ensurePageBusiness } from "@/lib/auth/session";

export const metadata = { title: "Resultatrapport" };

export default async function ResultatPage() {
  await ensurePageBusiness();
  const rr = resultatrapport();

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<SmartBack />}
        title="Resultatrapport"
        subtitle={`Hur det går för företaget ${rr.range.from} till ${rr.range.to} – direkt ur bokföringen.`}
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/bokforing/export?typ=resultat" className="text-[13px] font-medium text-accent hover:underline">
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
            <p className="text-[13px] text-muted">Omsättning</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">{kr(rr.omsattning)}</p>
          </div>
          <div>
            <p className="text-[13px] text-muted">Kostnader</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">−{kr(rr.kostnaderSumma)}</p>
          </div>
          <div>
            <p className="text-[13px] text-muted">Resultat före skatt</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight tabular">{kr(rr.resultatForeSkatt)}</p>
          </div>
        </div>
      </Card>

      {/* Full resultatrapport */}
      <details className="group" open>
        <summary className="mb-3 cursor-pointer list-none text-[14px] font-semibold text-accent hover:underline">
          Full resultatrapport per konto
        </summary>
        {/* Två kolumner (konto + belopp) – klarar smala skärmar utan minbredd/scroll. */}
        <Card className="px-5 py-4">
          <table className="w-full text-[13px]">
            <tbody>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <td className="pb-2">Intäkter</td>
                <td />
              </tr>
              {rr.intakter.map((r) => (
                <tr key={r.account} className="border-t border-line/50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-[12px] text-muted">{r.account}</span> {r.name}
                  </td>
                  <td className="py-1.5 text-right tabular">{kr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-2">Summa omsättning</td>
                <td className="py-2 text-right tabular">{kr(rr.omsattning)}</td>
              </tr>

              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <td className="pb-2 pt-4">Kostnader</td>
                <td />
              </tr>
              {rr.kostnader.map((r) => (
                <tr key={r.account} className="border-t border-line/50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-[12px] text-muted">{r.account}</span> {r.name}
                  </td>
                  <td className="py-1.5 text-right tabular">−{kr(r.amount)}</td>
                </tr>
              ))}
              {rr.avskrivningar.map((r) => (
                <tr key={r.account} className="border-t border-line/50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-[12px] text-muted">{r.account}</span> {r.name}
                  </td>
                  <td className="py-1.5 text-right tabular">−{kr(r.amount)}</td>
                </tr>
              ))}
              <tr className="border-t border-line font-semibold">
                <td className="py-2">Summa kostnader</td>
                <td className="py-2 text-right tabular">−{kr(rr.kostnaderSumma)}</td>
              </tr>

              <tr className="border-t-2 border-line text-[14px] font-semibold">
                <td className="py-2.5">Resultat före skatt</td>
                <td className="py-2.5 text-right tabular">{kr(rr.resultatForeSkatt)}</td>
              </tr>
              {rr.skatt !== 0 ? (
                <>
                  <tr className="border-t border-line/50">
                    <td className="py-1.5">Skatt på årets resultat</td>
                    <td className="py-1.5 text-right tabular">−{kr(rr.skatt)}</td>
                  </tr>
                  <tr className="border-t border-line font-semibold">
                    <td className="py-2">Resultat efter skatt</td>
                    <td className="py-2 text-right tabular">{kr(rr.resultat)}</td>
                  </tr>
                </>
              ) : null}
            </tbody>
          </table>
        </Card>
      </details>

      <p className="mt-4 text-[12px] text-muted">
        Rapporten byggs direkt från verifikationerna – samma siffror som i huvudboken och saldobalansen.
      </p>
    </div>
  );
}
