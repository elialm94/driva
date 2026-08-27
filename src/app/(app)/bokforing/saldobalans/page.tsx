import Link from "next/link";
import { Table2 } from "lucide-react";
import { kr } from "@/lib/format";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { saldobalans } from "@/lib/accounting/ledger";
import { fiscalYears } from "@/lib/accounting/fiscal";

export const metadata = { title: "Saldobalans" };

export default async function SaldobalansPage({ searchParams }: { searchParams: Promise<{ ar?: string }> }) {
  const params = await searchParams;
  const years = fiscalYears();
  const chosen = params.ar ? years.find((f) => f.label === params.ar) : undefined;
  const sb = chosen ? saldobalans({ from: chosen.startDate, to: chosen.endDate }) : saldobalans();
  const activeLabel = chosen?.label ?? sb.fiscalYear?.label;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/bokforing" fallbackLabel="Bokföring" />}
        title="Saldobalans"
        subtitle={`Alla konton med ingående balans, periodens debet/kredit och utgående balans (${sb.range.from} till ${sb.range.to}).`}
        actions={
          <div className="flex items-center gap-2">
            <a
              href={`/api/bokforing/export?typ=saldobalans${activeLabel ? `&ar=${activeLabel}` : ""}`}
              className="text-[13px] font-medium text-accent hover:underline"
            >
              Exportera CSV
            </a>
            <PrintButton />
          </div>
        }
      />

      {years.length > 1 ? (
        <div className="mb-5 flex flex-wrap gap-1.5 print:hidden">
          {years.map((f) => (
            <Link
              key={f.id}
              href={`/bokforing/saldobalans?ar=${f.label}`}
              className={cx(
                "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
                activeLabel === f.label ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
              )}
            >
              {f.label}
              {f.status === "stangt" ? " (stängt)" : ""}
            </Link>
          ))}
        </div>
      ) : null}

      {sb.rows.length === 0 ? (
        <EmptyState icon={Table2} title="Inget att visa" text="Det finns inga bokförda händelser i perioden." />
      ) : (
        <Card className="overflow-x-auto px-5 py-4">
          <table className="w-full min-w-[560px] text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                <th className="pb-2 font-semibold">Konto</th>
                <th className="pb-2 text-right font-semibold">Ingående balans</th>
                <th className="pb-2 text-right font-semibold">Debet</th>
                <th className="pb-2 text-right font-semibold">Kredit</th>
                <th className="pb-2 text-right font-semibold">Utgående balans</th>
              </tr>
            </thead>
            <tbody>
              {sb.rows.map((r) => (
                <tr key={r.account} className="border-t border-line/50">
                  <td className="py-1.5 pr-3">
                    <span className="font-mono text-[12px] text-muted">{r.account}</span> {r.name}
                  </td>
                  <td className="py-1.5 text-right tabular">{r.ib !== 0 ? kr(r.ib) : ""}</td>
                  <td className="py-1.5 text-right tabular">{r.debit !== 0 ? kr(r.debit) : ""}</td>
                  <td className="py-1.5 text-right tabular">{r.credit !== 0 ? kr(r.credit) : ""}</td>
                  <td className="py-1.5 text-right font-medium tabular">{kr(r.ub)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-line font-semibold">
                <td className="py-2">Summa</td>
                <td className="py-2 text-right tabular">{kr(sb.sumIb)}</td>
                <td className="py-2 text-right tabular">{kr(sb.sumDebit)}</td>
                <td className="py-2 text-right tabular">{kr(sb.sumCredit)}</td>
                <td className="py-2 text-right tabular">{kr(sb.sumUb)}</td>
              </tr>
            </tbody>
          </table>
        </Card>
      )}

      <p className="mt-3 text-[12px] text-muted">
        {sb.sumDebit === sb.sumCredit
          ? `✓ Debet och kredit balanserar (${kr(sb.sumDebit)} = ${kr(sb.sumCredit)}).`
          : `⚠ Debet och kredit skiljer sig – kontakta support.`}{" "}
        Saldobalansen är grunden för resultat- och balansrapporten och för bokslutet.
      </p>
    </div>
  );
}
