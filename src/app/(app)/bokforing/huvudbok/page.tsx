import Link from "next/link";
import { BookOpenText } from "lucide-react";
import { kr } from "@/lib/format";
import { Card, EmptyState, PageHeader, cx } from "@/components/ui";
import { BackLink } from "@/components/back-link";
import { huvudbok } from "@/lib/accounting/ledger";
import { PrintButton } from "@/components/bokforing-widgets";
import { BokforingAdvancedTabs } from "@/components/bokforing-advanced-nav";

export const metadata = { title: "Huvudbok" };

export default async function HuvudbokPage({ searchParams }: { searchParams: Promise<{ konto?: string }> }) {
  const params = await searchParams;
  const selected = params.konto ? Number(params.konto) : undefined;
  const accounts = huvudbok();
  const shown = selected ? accounts.filter((a) => a.account === selected) : accounts;

  return (
    <div className="animate-fade-up">
      <PageHeader
        back={<BackLink fallbackHref="/bokforing" fallbackLabel="Bokföring" />}
        title="Huvudbok"
        subtitle="Alla händelser konto för konto, med ingående saldo, rader och utgående saldo."
        actions={
          <div className="flex items-center gap-2">
            <a href="/api/bokforing/export?typ=huvudbok" className="text-[13px] font-medium text-accent hover:underline">
              Exportera CSV
            </a>
            <PrintButton />
          </div>
        }
      />
      <BokforingAdvancedTabs />

      {/* Kontoväljare */}
      <div className="mb-6 flex flex-wrap gap-1.5 print:hidden">
        <Link
          href="/bokforing/huvudbok"
          className={cx(
            "rounded-full px-3 py-1 text-[12.5px] font-medium transition-colors",
            !selected ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
          )}
        >
          Alla konton
        </Link>
        {accounts.map((a) => (
          <Link
            key={a.account}
            href={`/bokforing/huvudbok?konto=${a.account}`}
            className={cx(
              "rounded-full px-3 py-1 font-mono text-[12.5px] font-medium transition-colors",
              selected === a.account ? "bg-ink text-white" : "bg-canvas text-soft hover:bg-line/60"
            )}
          >
            {a.account}
          </Link>
        ))}
      </div>

      {shown.length === 0 ? (
        <EmptyState icon={BookOpenText} title="Inget att visa" text="Det finns inga bokförda händelser på kontot i år." />
      ) : (
        <div className="space-y-5">
          {shown.map((a) => (
            <Card key={a.account} className="overflow-x-auto px-5 py-4">
              <div className="flex items-baseline justify-between gap-3">
                <h3 className="text-[15px] font-semibold">
                  <span className="font-mono text-[13px] text-muted">{a.account}</span> {a.name}
                </h3>
                <p className="text-[13px] text-soft">
                  UB <span className="font-semibold tabular text-ink">{kr(a.ub)}</span>
                </p>
              </div>
              <table className="mt-3 w-full min-w-[540px] text-[13px]">
                <thead>
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                    <th className="pb-1.5 font-semibold">Datum</th>
                    <th className="pb-1.5 font-semibold">Ver.</th>
                    <th className="pb-1.5 font-semibold">Beskrivning</th>
                    <th className="pb-1.5 text-right font-semibold">Debet</th>
                    <th className="pb-1.5 text-right font-semibold">Kredit</th>
                    <th className="pb-1.5 text-right font-semibold">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-line/50 text-muted">
                    <td className="py-1.5" colSpan={5}>
                      Ingående saldo
                    </td>
                    <td className="py-1.5 text-right tabular">{kr(a.ib)}</td>
                  </tr>
                  {a.rows.map((r, i) => (
                    <tr key={i} className="border-t border-line/50">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{r.date}</td>
                      <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{r.verificationLabel}</td>
                      <td className="max-w-[260px] truncate py-1.5 pr-3">{r.description}</td>
                      <td className="py-1.5 text-right tabular">{r.debit ? kr(r.debit) : ""}</td>
                      <td className="py-1.5 text-right tabular">{r.credit ? kr(r.credit) : ""}</td>
                      <td className="py-1.5 text-right tabular">{kr(r.balance)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-line font-medium">
                    <td className="py-1.5" colSpan={5}>
                      Utgående saldo
                    </td>
                    <td className="py-1.5 text-right tabular">{kr(a.ub)}</td>
                  </tr>
                </tbody>
              </table>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
