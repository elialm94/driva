import { Check, CircleAlert, Landmark } from "lucide-react";
import { kr, datumLang } from "@/lib/format";
import { Badge, Card, cx } from "./ui";
import { GenerateVatReportButton, MarkVatDeclaredButton } from "./bokforing-widgets";
import { BookVatOnTaxAccountButton } from "./skattekonto-widgets";
import { vatChecklist, type VatPeriodSummary } from "@/lib/accounting/vat";
import { VAT_PERIOD_STATE } from "@/lib/status-labels";

export function MomsPeriods({
  periods,
  readOnly,
  awaitingTaxAccount,
}: {
  periods: VatPeriodSummary[];
  readOnly?: boolean;
  /** Id på deklarerade rapporter som ännu inte förts över till skattekontot. */
  awaitingTaxAccount?: readonly string[];
}) {
  return (
    <div className="space-y-4">
      {periods.map((p) => {
        const checklist = p.state === "att_deklarera" ? vatChecklist(p.period) : [];
        const blockers = checklist.filter((c) => !c.ok);
        return (
          <Card key={p.period.key} className="px-6 py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2.5">
                  <Landmark className="size-4.5 text-muted" />
                  <h3 className="text-[15px] font-semibold">{p.period.label}</h3>
                  <Badge tone={VAT_PERIOD_STATE[p.state].tone}>
                    {p.state === "deklarerad" ? `✓ ${VAT_PERIOD_STATE.deklarerad.label}` : VAT_PERIOD_STATE[p.state].label}
                  </Badge>
                </div>
                <p className="mt-1 text-[13px] text-soft">
                  {p.state === "pagaende" ? "Perioden pågår. " : ""}
                  Deklareras senast <span className="font-medium text-ink">{datumLang(p.dueDate)}</span>
                  {p.report?.declaredAt ? ` · markerad som deklarerad ${datumLang(p.report.declaredAt)}` : ""}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[12px] text-muted">{p.position.attBetala >= 0 ? "Att betala" : "Att få tillbaka"}</p>
                <p className="text-[22px] font-semibold tracking-tight tabular">{kr(Math.abs(p.position.attBetala))}</p>
              </div>
            </div>

            <details className="group mt-4" open={p.state === "att_deklarera"}>
              <summary className="cursor-pointer list-none text-[13px] font-medium text-accent hover:underline">
                Visa underlag per deklarationsruta
              </summary>
              <div className="mt-3 overflow-x-auto rounded-xl bg-canvas/70 px-4 py-3">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
                      <th className="pb-1.5 font-semibold">Ruta</th>
                      <th className="pb-1.5 font-semibold">Beskrivning</th>
                      <th className="pb-1.5 text-right font-semibold">Belopp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {p.position.boxes.map((b) => (
                      <tr key={b.code} className="border-t border-line/50">
                        <td className="py-1.5 pr-3 font-mono text-[12px] text-muted">{b.code}</td>
                        <td className="py-1.5 pr-3">{b.label}</td>
                        <td className={cx("py-1.5 text-right tabular", b.code === "49" && "font-semibold")}>{kr(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-2 flex flex-wrap gap-3">
                  <a
                    href={`/api/bokforing/export?typ=moms&period=${p.period.key}`}
                    className="text-[13px] font-medium text-accent hover:underline"
                  >
                    Exportera underlag (CSV)
                  </a>
                </div>
              </div>
            </details>

            {p.state === "att_deklarera" ? (
              <div className="mt-4 border-t border-line/60 pt-4">
                <p className="mb-2.5 text-[13px] font-semibold">Innan du deklarerar</p>
                <ul className="mb-4 space-y-1.5">
                  {checklist.map((c) => (
                    <li key={c.key} className="flex items-start gap-2 text-[13px]">
                      {c.ok ? (
                        <Check className="mt-0.5 size-4 shrink-0 text-ok" />
                      ) : (
                        <CircleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
                      )}
                      <span>
                        <span className={c.ok ? "text-soft" : "font-medium"}>{c.label}</span>
                        {c.detail ? <span className="block text-[12px] text-muted">{c.detail}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                {readOnly ? (
                  <p className="text-[13px] text-soft">Endast läsning – revisorer kan inte ändra momsen.</p>
                ) : p.report ? (
                  blockers.length === 0 ? (
                    <MarkVatDeclaredButton reportId={p.report.id} attBetala={p.report.attBetala} />
                  ) : (
                    <p className="text-[13px] text-soft">Åtgärda punkterna ovan innan momsen markeras som deklarerad.</p>
                  )
                ) : (
                  <GenerateVatReportButton periodKey={p.period.key} label="Skapa momsrapport" />
                )}
              </div>
            ) : null}

            {p.state === "deklarerad" && p.report ? (
              <div className="mt-3">
                <p className="text-[12px] text-muted">
                  Momsen fördes om till redovisningskontot (2650) och perioden låstes. Siffrorna är frysta som de såg ut
                  vid deklarationen.
                </p>
                {!readOnly && awaitingTaxAccount?.includes(p.report.id) ? (
                  <div className="mt-3 border-t border-line/60 pt-3">
                    <BookVatOnTaxAccountButton
                      reportId={p.report.id}
                      label={p.period.label}
                      attBetala={p.report.attBetala}
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </Card>
        );
      })}
      <p className="text-[12px] leading-relaxed text-muted">
        Driva skickar aldrig något till Skatteverket. Du deklarerar som vanligt på skatteverket.se – Driva ger dig exakta
        siffror per ruta och håller ordning på vad som är deklarerat.
      </p>
    </div>
  );
}
