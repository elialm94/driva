import Link from "next/link";
import { kr } from "@/lib/format";
import { Card } from "./ui";
import type { FinanceOverview } from "@/lib/services/finance";

/**
 * Pengarna på Hem: vad som finns på kontot, vad som är reserverat till
 * Skatteverket och leverantörer, och vad som ungefär är ledigt. Samma
 * siffror som financeOverview() – assistenten och den här listen ljuger
 * aldrig åt olika håll.
 */
export function HomeMoneyStrip({
  finance,
  unpaid,
  overdue,
}: {
  finance: FinanceOverview;
  unpaid: number;
  overdue: number;
}) {
  return (
    <section className="mt-8" data-home-money>
      <div className="grid gap-3 sm:grid-cols-3">
        <MoneyCell href="/ekonomi?flik=bank" label="På kontot" value={finance.bank} />
        <MoneyCell href="/bokforing" label="Reserverat" value={finance.reserved} hint="Moms, F-skatt och löneskatt" />
        <MoneyCell
          href="/ekonomi?flik=bank"
          label="Ungefär ledigt"
          value={finance.available}
          hint={finance.upcoming > 0 ? `${kr(finance.upcoming)} i leverantörsfakturor` : undefined}
          emphasize
        />
      </div>
      {unpaid > 0 ? (
        <Card className="mt-3 px-4 py-3">
          <Link href="/ekonomi?flik=fakturor" className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
            <span className="text-soft">
              Utestående kundfordringar
              {overdue > 0 ? <span className="text-danger"> · {kr(overdue)} förfallet</span> : null}
            </span>
            <span className="font-semibold tabular">{kr(unpaid)}</span>
          </Link>
        </Card>
      ) : null}
    </section>
  );
}

function MoneyCell({
  href,
  label,
  value,
  hint,
  emphasize,
}: {
  href: string;
  label: string;
  value: number;
  hint?: string;
  emphasize?: boolean;
}) {
  return (
    <Link href={href as never}>
      <Card className="h-full px-4 py-3.5">
        <p className="text-[11px] text-muted">{label}</p>
        <p className={`mt-0.5 font-semibold tabular tracking-tight ${emphasize ? "text-[22px]" : "text-[20px]"}`}>
          {kr(value)}
        </p>
        {hint ? <p className="mt-0.5 text-[12px] text-muted">{hint}</p> : null}
      </Card>
    </Link>
  );
}
