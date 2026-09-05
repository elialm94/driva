import Link from "next/link";
import { Check, CircleAlert } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui";
import { SmartBack } from "@/components/back-link";
import { PrintButton } from "@/components/bokforing-widgets";
import { kr } from "@/lib/format";
import { cx } from "@/components/ui";
import { ensurePageBusiness } from "@/lib/auth/session";
import { fiscalYears } from "@/lib/accounting/fiscal";
import { balanceReconciliation, TIE_OUT_LABEL } from "@/lib/accounting/balance-reconciliation";

export const metadata = { title: "Avstämning" };

/**
 * Avstämning per balanskonto. Ett saldo är bara trovärdigt om något utanför
 * bokföringen säger samma sak: banken, Skatteverkets utdrag, fakturaregistret.
 * Sidan visar varje balanskonto vid sidan av sitt underlag och pekar på
 * skillnaden när den finns.
 */
export default async function AvstamningPage() {
  await ensurePageBusiness();
  const openYears = fiscalYears().filter((f) => f.status === "oppet");
  const fy = openYears[0];

  if (!fy) {
    return (
      <div>
        <PageHeader back={<SmartBack />} title="Avstämning" subtitle="Balanskontona mot sina underlag." />
        <Card className="px-6 py-5">
          <p className="text-[14px] text-soft">
            Alla räkenskapsår är stängda. Ett nytt år öppnas automatiskt vid nästa bokförda händelse.
          </p>
        </Card>
      </div>
    );
  }

  const tieOut = balanceReconciliation(fy.id);

  return (
    <div>
      <PageHeader
        back={<SmartBack />}
        title={`Avstämning ${fy.label}`}
        subtitle="Ett saldo är trovärdigt först när något utanför bokföringen säger samma sak."
        actions={<PrintButton />}
      />

      <Card className={cx("mb-6 px-6 py-5", tieOut.ok ? "" : "border-warn/40")}>
        <div className="flex items-start gap-2.5">
          {tieOut.ok ? (
            <Check className="mt-0.5 size-5 shrink-0 text-ok" />
          ) : (
            <CircleAlert className="mt-0.5 size-5 shrink-0 text-warn" />
          )}
          <div>
            <h3 className="text-[15px] font-semibold">
              {tieOut.ok
                ? `Alla ${tieOut.rows.length} balanskonton stämmer mot sina underlag`
                : `${tieOut.unexplained.length} konto${tieOut.unexplained.length === 1 ? "" : "n"} går inte ihop`}
            </h3>
            <p className="mt-1 text-[13px] leading-relaxed text-soft">
              {tieOut.ok
                ? "Bokslutet kan slutföras. Varje saldo har ett underlag utanför bokföringen som säger samma sak."
                : "Skillnaden nedan måste förklaras innan året kan stängas. Ett saldo som inte stämmer mot sitt underlag är en felkälla som följer med till nästa år."}
            </p>
            {tieOut.manual.length > 0 ? (
              <p className="mt-2 text-[13px] leading-relaxed text-soft">
                {tieOut.manual.length} konto{tieOut.manual.length === 1 ? "" : "n"} saknar delsystem i Driva – ett
                banklån eller en skuld till en aktieägare har inget register att jämföra mot. De stoppar inte bokslutet,
                men stäm av dem mot lånebeskedet eller avtalet och lägg vid en specifikation.
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      <Card className="mb-6 overflow-x-auto px-5 py-4">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
              <th className="pb-1.5 font-semibold">Konto</th>
              <th className="pb-1.5 text-right font-semibold">Bokföringen</th>
              <th className="pb-1.5 font-semibold">Underlag</th>
              <th className="pb-1.5 text-right font-semibold">Underlaget säger</th>
              <th className="pb-1.5 text-right font-semibold">Skillnad</th>
            </tr>
          </thead>
          <tbody>
            {tieOut.rows.map((row) => (
              <tr key={row.account} className={cx("border-t border-line/50", !row.ok && "bg-warn-soft/40")}>
                <td className="py-2 pr-3 align-top">
                  <span className="flex items-center gap-2">
                    {row.ok ? (
                      <Check className="size-3.5 shrink-0 text-ok" />
                    ) : (
                      <CircleAlert className="size-3.5 shrink-0 text-warn" />
                    )}
                    <span className="font-medium">
                      {row.account} {row.name}
                    </span>
                  </span>
                  <span className="mt-0.5 block pl-5 text-[12px] text-muted">
                    {row.detail}
                    {!row.ok && row.href ? (
                      <>
                        {" "}
                        <Link href={row.href as never} className="font-medium text-accent hover:underline">
                          {row.hrefLabel ?? "Visa"}
                        </Link>
                      </>
                    ) : null}
                  </span>
                </td>
                <td className="py-2 text-right align-top tabular">{kr(row.ledger)}</td>
                <td className="py-2 pl-3 pr-3 align-top text-soft">{TIE_OUT_LABEL[row.source]}</td>
                <td className="py-2 text-right align-top tabular">
                  {row.subsystem === undefined ? <span className="text-muted">–</span> : kr(row.subsystem)}
                </td>
                <td className="py-2 text-right align-top">
                  {row.manual ? (
                    <Badge tone="neutral">För hand</Badge>
                  ) : row.difference === 0 ? (
                    <Badge tone="ok">Stämmer</Badge>
                  ) : (
                    <span className="font-semibold tabular text-warn">{kr(row.difference)}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <p className="mt-6 text-[12px] leading-relaxed text-muted">
        Avstämningen jämför huvudbokens utgående saldo med det delsystem som äger uppgiften: fakturaregistret för
        kundfordringar och leverantörsskulder, banken för företagskontot, Skatteverkets utdrag för skattekontot,
        inventarieregistret för anläggningstillgångar och bokslutsbilagorna för semesterlöneskuld, nedskrivningar och
        periodiseringsfond. Konton utan delsystem – eget kapital och årets resultat – bär sin egen historik och stäms av
        mot föregående års balansräkning.
      </p>
    </div>
  );
}
