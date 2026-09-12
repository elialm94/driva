import Link from "next/link";
import { Card, SectionTitle } from "@/components/ui";
import { resultatrapport } from "@/lib/accounting/ledger";
import { monthsOf } from "@/lib/accounting/dates";
import { currentFiscalYear, fiscalYears } from "@/lib/accounting/fiscal";
import { kr } from "@/lib/format";

const BOLAGSSKATT = 0.206;

/**
 * Resultat per månad för innevarande räkenskapsår, med förra året som
 * spökstapel. Preliminär bolagsskatt är 20,6 % på resultat före skatt.
 */
export function ResultatOverview() {
  const fy = currentFiscalYear();
  if (!fy) return null;
  const prev = fiscalYears().find((f) => f.endDate < fy.startDate && f.id !== fy.id);
  const months = monthsOf(fy);
  const rows = months.map((month) => {
    const current = resultatrapport({ from: month.start, to: month.end }).resultatForeSkatt;
    const prevMonth = prev
      ? monthsOf(prev).find((m) => m.key.slice(5) === month.key.slice(5))
      : undefined;
    const lastYear = prevMonth
      ? resultatrapport({ from: prevMonth.start, to: prevMonth.end }).resultatForeSkatt
      : null;
    return { key: month.key, label: month.label, current, lastYear };
  });
  const ytd = resultatrapport({ from: fy.startDate }).resultatForeSkatt;
  const tax = Math.round(Math.max(0, ytd) * BOLAGSSKATT);
  const maxAbs = Math.max(1, ...rows.flatMap((r) => [Math.abs(r.current), Math.abs(r.lastYear ?? 0)]));

  return (
    <section className="mb-8">
      <SectionTitle>Resultatet i år</SectionTitle>
      <Card className="px-5 py-4">
        <div className="flex h-36 items-end gap-1.5">
          {rows.map((r) => {
            const h = Math.round((Math.abs(r.current) / maxAbs) * 100);
            const ghost = r.lastYear != null ? Math.round((Math.abs(r.lastYear) / maxAbs) * 100) : 0;
            return (
              <div key={r.key} className="flex min-w-0 flex-1 flex-col items-center justify-end gap-1">
                <div className="relative flex h-28 w-full items-end justify-center gap-0.5">
                  {r.lastYear != null ? (
                    <div
                      className="w-[38%] rounded-sm bg-ink/15"
                      style={{ height: `${Math.max(ghost, r.lastYear === 0 ? 2 : 0)}%` }}
                      title={`Förra året ${kr(r.lastYear)}`}
                    />
                  ) : null}
                  <div
                    className={`w-[46%] rounded-sm ${r.current < 0 ? "bg-warn/70" : "bg-ink/70"}`}
                    style={{ height: `${Math.max(h, r.current === 0 ? 2 : 0)}%` }}
                    title={kr(r.current)}
                  />
                </div>
                <span className="text-[10px] capitalize text-muted">{r.label.slice(0, 3)}</span>
              </div>
            );
          })}
        </div>
        <p className="mt-3 text-[13px] text-muted">År hittills</p>
        <p className="text-[22px] font-semibold tracking-tight tabular">{kr(ytd)}</p>
        <p className="mt-1 text-[13px] text-soft">Preliminär bolagsskatt ca {kr(tax)}</p>
        <p className="mt-3 text-[13px]">
          <Link href="/bokforing/resultat" className="font-medium text-accent hover:underline">
            Visa rapporter
          </Link>
        </p>
      </Card>
    </section>
  );
}
