import Link from "next/link";
import { Info } from "lucide-react";
import { Card, cx } from "./ui";
import { kr } from "@/lib/format";
import type { QuoteDeviation } from "@/lib/services/invoice-quote-deviation";
import { QUOTE_EXCESS_WARN_AMOUNT, QUOTE_EXCESS_WARN_PERCENT } from "@/lib/quote-excess";

function signedKr(n: number): string {
  if (n > 0) return `+${kr(n)}`;
  if (n < 0) return `−${kr(Math.abs(n))}`;
  return kr(0);
}

export function QuoteDeviationCard({ deviation }: { deviation: QuoteDeviation }) {
  const warn = deviation.largeExcess;

  return (
    <Card className={cx("mb-6 px-5 py-4", warn ? "border-warn/25 bg-warn-soft/40" : "border-info/15 bg-info-soft/40")}>
      <div className="flex items-start gap-3">
        <Info className={cx("mt-0.5 size-5 shrink-0", warn ? "text-warn" : "text-info")} />
        <div className="min-w-0 flex-1 text-[14px] leading-relaxed text-soft">
          <p className={cx("font-semibold", warn ? "text-warn" : "text-ink")}>Fakturan avviker från den godkända offerten</p>
          <dl className="mt-3 grid gap-1.5 sm:grid-cols-[auto_1fr] sm:gap-x-6">
            <dt>Godkänd offert</dt>
            <dd>
              <span className="font-medium text-ink">{kr(deviation.approvedAmount)}</span>
              <span className="text-muted"> · {deviation.baselineLabel}</span>
            </dd>
            <dt>Fakturerat totalt</dt>
            <dd>
              <span className="font-medium text-ink">{kr(deviation.invoicedAmount)}</span>
              <span className="text-muted"> · den här fakturan</span>
            </dd>
            <dt>Skillnad</dt>
            <dd>
              <span className={cx("font-semibold", deviation.delta > 0 ? (warn ? "text-warn" : "text-ink") : "text-ink")}>
                {signedKr(deviation.delta)}
              </span>
            </dd>
          </dl>

          {deviation.addedLines.length > 0 ? (
            <div className="mt-3">
              <p className="font-medium text-ink">Tillagt efter offert</p>
              <ul className="mt-1 space-y-0.5">
                {deviation.addedLines.map((line, i) => (
                  <li key={`${line.description}-${i}`}>
                    {line.description}: {signedKr(line.amount)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {deviation.rotChanged ? (
            <p className="mt-2 text-[13px]">ROT/RUT på fakturan skiljer sig från den godkända offerten.</p>
          ) : null}

          <p className="mt-3 text-[13px] text-muted">
            Offerten är oförändrad – det här är bara en jämförelse för dig, inte något kunden ser.
            {warn
              ? ` Vi varnar innan skickning när fakturan är mer än ${kr(QUOTE_EXCESS_WARN_AMOUNT)} eller ${QUOTE_EXCESS_WARN_PERCENT} % högre.`
              : ""}
          </p>

          {warn ? (
            <p className="mt-2">
              <Link href={deviation.tillaggHref as never} className="font-medium text-ink underline-offset-2 hover:underline">
                Skapa tilläggsoffert
              </Link>
            </p>
          ) : null}
        </div>
      </div>
    </Card>
  );
}
